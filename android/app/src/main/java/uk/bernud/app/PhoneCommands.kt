package uk.bernud.app

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.ContactsContract
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.util.Log
import android.view.KeyEvent
import java.util.Locale

// Runs Bernard's phone commands natively (replaces the Tasker task).
// Commands arrive as "<secret>|<action>|<arg>" on the private ntfy topic.
class PhoneCommands(private val ctx: Context, private val report: (String, Boolean, String) -> Unit = { _, _, _ -> }) {
    private val tag = "BernudPhone"
    private val main = Handler(Looper.getMainLooper())
    private val audio = ctx.getSystemService(AudioManager::class.java)
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var player: MediaPlayer? = null
    private var ringer: MediaPlayer? = null

    init {
        tts = TextToSpeech(ctx) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) tts?.language = Locale.UK
        }
    }

    fun shutdown() {
        tts?.shutdown(); player?.release(); ringer?.release()
    }

    fun handle(action: String, arg: String) {
        Log.i(tag, "command $action")
        try {
            when (action) {
                "speak" -> playUrl(arg)
                "say" -> say(arg)
                "torch" -> torch(arg.trim().equals("on", true))
                "volume" -> volume(arg)
                "media" -> media(arg.trim().lowercase())
                "open_url" -> openUri(Uri.parse(arg.trim()))
                "open_app" -> openApp(arg.trim())
                "ring" -> ring()
                "stop_ring" -> stopRing()
                "dnd" -> dnd(arg.trim().equals("on", true))
                "brightness" -> brightness(arg.trim())
                "wa_call" -> waCall(arg.trim(), video = false)
                "wa_video" -> waCall(arg.trim(), video = true)
                "wa_message" -> waMessage(arg)
                else -> Log.w(tag, "unknown action $action")
            }
            report(action, true, "")
        } catch (e: Exception) {
            Log.e(tag, "failed $action", e)
            report(action, false, e.toString())
            say("Sorry, that didn't work on the phone.")
        }
    }

    // ---- speech ----
    private fun playUrl(url: String) {
        main.post {
            player?.release()
            player = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                setDataSource(url)
                setOnPreparedListener { it.start() }
                setOnCompletionListener { it.release(); if (player === it) player = null }
                setOnErrorListener { mp, what, extra -> report("speak_playback", false, "MediaPlayer error $what/$extra"); mp.release(); if (player === mp) player = null; true }
                prepareAsync()
            }
        }
    }

    fun say(text: String) {
        if (text.isBlank()) return
        val t = tts ?: return
        if (ttsReady) t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "bernud")
        else main.postDelayed({ if (ttsReady) t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "bernud") }, 1500)
    }

    // ---- hardware ----
    private fun torch(on: Boolean) {
        val cm = ctx.getSystemService(CameraManager::class.java)
        val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true } ?: return
        cm.setTorchMode(id, on)
    }

    private fun volume(arg: String) {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val cur = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
        val a = arg.trim().lowercase()
        val target = when {
            a.startsWith("up") -> cur + max / 5
            a.startsWith("down") -> cur - max / 5
            a.toIntOrNull() != null -> Math.round(a.toInt() * max / 15f)
            else -> return
        }
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, target.coerceIn(0, max), AudioManager.FLAG_SHOW_UI)
    }

    private fun media(cmd: String) {
        val key = when (cmd) {
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "previous", "prev" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "play" -> KeyEvent.KEYCODE_MEDIA_PLAY
            else -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
        }
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, key))
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, key))
    }

    // Find my phone: plays the ringtone on the alarm channel at full volume, so it sounds even on silent.
    private fun ring() {
        main.post {
            stopRing()
            audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ringer = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                setDataSource(ctx, uri)
                isLooping = true
                setOnPreparedListener { it.start() }
                prepareAsync()
            }
            main.postDelayed({ stopRing() }, 30_000)
        }
    }

    private fun stopRing() { ringer?.let { try { it.stop() } catch (_: Exception) {}; it.release() }; ringer = null }

    private fun dnd(on: Boolean) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (!nm.isNotificationPolicyAccessGranted) { say("I need Do Not Disturb access first. Open the Bernard app to allow it."); return }
        nm.setInterruptionFilter(if (on) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL)
    }

    private fun brightness(arg: String) {
        if (!Settings.System.canWrite(ctx)) { say("I need permission to change settings first. Open the Bernard app to allow it."); return }
        val v = arg.toIntOrNull()?.coerceIn(1, 255) ?: return
        Settings.System.putInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
        Settings.System.putInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS, v)
    }

    // ---- apps ----
    private fun start(i: Intent) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (!Settings.canDrawOverlays(ctx)) Log.w(tag, "no overlay permission; Android may block opening apps from the background")
        ctx.startActivity(i)
    }

    private fun openUri(u: Uri) = start(Intent(Intent.ACTION_VIEW, u))

    private fun openApp(name: String) {
        val pm = ctx.packageManager
        val q = name.lowercase().removeSuffix(" app").trim()
        val apps = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), PackageManager.MATCH_ALL)
        val label = { r: android.content.pm.ResolveInfo -> r.loadLabel(pm).toString().lowercase() }
        val hit = apps.firstOrNull { label(it) == q } ?: apps.firstOrNull { label(it).startsWith(q) } ?: apps.firstOrNull { label(it).contains(q) }
        if (hit == null) { say("I couldn't find an app called $name."); return }
        start(pm.getLaunchIntentForPackage(hit.activityInfo.packageName) ?: return)
    }

    // ---- WhatsApp ----
    private fun contactRow(mime: String, name: String, column: String): String? {
        if (ctx.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            say("I need access to your contacts first. Open the Bernard app to allow it."); return null
        }
        val like = "%" + name.replace("'", "_") + "%"
        ctx.contentResolver.query(
            ContactsContract.Data.CONTENT_URI, arrayOf(column),
            "${ContactsContract.Data.MIMETYPE}=? AND ${ContactsContract.Data.DISPLAY_NAME} LIKE ?",
            arrayOf(mime, like), "${ContactsContract.Data.DISPLAY_NAME} ASC"
        )?.use { c -> if (c.moveToFirst()) return c.getString(0) }
        return null
    }

    private fun waCall(name: String, video: Boolean) {
        val mime = if (video) "vnd.android.cursor.item/vnd.com.whatsapp.video.call" else "vnd.android.cursor.item/vnd.com.whatsapp.voip.call"
        val id = contactRow(mime, name, ContactsContract.Data._ID) ?: run { say("I couldn't find $name on WhatsApp."); return }
        start(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://com.android.contacts/data/$id"), mime).setPackage("com.whatsapp"))
    }

    private fun waMessage(arg: String) {
        val parts = arg.split("::", limit = 2)
        val name = parts[0].trim()
        val text = parts.getOrElse(1) { "" }   // already URL-encoded by the server
        val jid = contactRow("vnd.android.cursor.item/vnd.com.whatsapp.profile", name, ContactsContract.Data.DATA1)
            ?: run { say("I couldn't find $name on WhatsApp."); return }
        val number = jid.substringBefore("@").filter { it.isDigit() }
        start(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$number?text=$text")).setPackage("com.whatsapp"))
    }
}
