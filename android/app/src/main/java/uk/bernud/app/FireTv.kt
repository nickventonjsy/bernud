package uk.bernud.app

import android.content.Context
import dadb.AdbKeyPair
import dadb.Dadb
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

// Controls the Amazon Fire TV Stick over the home Wi-Fi using ADB (Fire TV's developer "ADB debugging").
// Arg from the server: "<ip>;<action>;<value>".
object FireTv {
    private val worker = Executors.newSingleThreadExecutor()
    private var conn: Dadb? = null
    private var connHost = ""

    private val KEYS = mapOf(
        "on" to 224, "off" to 223, "home" to 3, "back" to 4, "play_pause" to 85, "up" to 19, "down" to 20,
        "left" to 21, "right" to 22, "select" to 23, "volume_up" to 24, "volume_down" to 25, "mute" to 164,
        "rewind" to 89, "fast_forward" to 90, "menu" to 82,
    )
    private val APPS = linkedMapOf(
        "netflix" to "com.netflix.ninja", "youtube" to "com.amazon.firetv.youtube", "prime" to "com.amazon.avod",
        "amazon" to "com.amazon.avod", "iplayer" to "uk.co.bbc.iplayer", "bbc" to "uk.co.bbc.iplayer",
        "disney" to "com.disney.disneyplus", "spotify" to "com.spotify.tv.android", "plex" to "com.plexapp.android",
        "itv" to "air.ITVMobilePlayer", "channel 4" to "com.channel4.ondemand", "all 4" to "com.channel4.ondemand",
        "now" to "com.nowtv.wetv", "apple tv" to "com.apple.atve.amazon.appletv", "twitch" to "tv.twitch.android.viewer",
    )

    private fun keyPair(ctx: Context): AdbKeyPair {
        val priv = File(ctx.filesDir, "adbkey"); val pub = File(ctx.filesDir, "adbkey.pub")
        if (!priv.exists() || !pub.exists()) AdbKeyPair.generate(priv, pub)
        return AdbKeyPair.read(priv, pub)
    }

    private fun dadb(ctx: Context, ip: String): Dadb {
        conn?.let { if (connHost == ip) return it }
        try { conn?.close() } catch (_: Exception) {}
        return Dadb.create(ip, 5555, keyPair(ctx), connectTimeout = 5000).also { conn = it; connHost = ip }
    }

    private fun shell(ctx: Context, ip: String, cmd: String): String {
        return try { dadb(ctx, ip).shell(cmd).output }
        catch (e: Exception) {
            // Stale connection (Fire TV slept or restarted): reconnect once.
            try { conn?.close() } catch (_: Exception) {}
            conn = null
            dadb(ctx, ip).shell(cmd).output
        }
    }

    fun run(ctx: Context, arg: String): String {
        val p = arg.split(";", limit = 3)
        val ip = p.getOrElse(0) { "" }.trim()
        val action = p.getOrElse(1) { "" }.trim().lowercase()
        val value = p.getOrElse(2) { "" }.trim()
        if (ip.isEmpty()) throw Fail("The Fire TV's address isn't set.")
        val job = worker.submit<String> { act(ctx, ip, action, value) }
        return try { job.get(9, TimeUnit.SECONDS) }
        catch (e: TimeoutException) { throw Fail("The Fire TV didn't answer. If it's the first time, look at the TV: allow USB debugging for this phone (tick Always allow), then ask again. Otherwise check the Fire TV is on and the phone is on the home Wi-Fi.") }
        catch (e: java.util.concurrent.ExecutionException) { throw Fail("Couldn't reach the Fire TV at $ip: ${e.cause?.message ?: "connection failed"}. Check ADB debugging is on and the phone is on the home Wi-Fi.") }
    }

    private fun act(ctx: Context, ip: String, action: String, value: String): String {
        KEYS[action]?.let { code -> shell(ctx, ip, "input keyevent $code"); return when (action) { "on" -> "Fire TV on."; "off" -> "Fire TV asleep."; else -> "Done." } }
        return when (action) {
            "status" -> { shell(ctx, ip, "echo ok"); "The Fire TV is connected." }
            "apps" -> {
                val pkgs = shell(ctx, ip, "pm list packages -3").lines().map { it.removePrefix("package:").trim() }.filter { it.isNotEmpty() }
                "Apps on the Fire TV: " + pkgs.take(40).joinToString(", ")
            }
            "open" -> {
                val want = value.lowercase().replace(Regex("\\b(the|app)\\b"), "").trim()
                if (want.isEmpty()) throw Fail("Which app?")
                val installed = shell(ctx, ip, "pm list packages").lines().map { it.removePrefix("package:").trim() }.toSet()
                val known = APPS.entries.firstOrNull { want.contains(it.key) }?.value
                val pkg = known?.takeIf { it in installed }
                    ?: installed.firstOrNull { pk -> want.split(" ").filter { it.length > 2 }.any { pk.lowercase().contains(it.replace(" ", "")) } }
                    ?: throw Fail("I couldn't find $value on the Fire TV.")
                shell(ctx, ip, "input keyevent 224")   // wake it first
                shell(ctx, ip, "monkey -p $pkg -c android.intent.category.LAUNCHER 1")
                "Opening $value on the Fire TV."
            }
            else -> throw Fail("The Fire TV doesn't know '$action'.")
        }
    }
}
