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
class Fail(message: String) : Exception(message)

class PhoneCommands(private val ctx: Context) {
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

    // Runs one command; returns (ok, what happened) for Bernard to tell Nicholas.
    fun handle(action: String, arg: String): Pair<Boolean, String> {
        Log.i(tag, "command $action")
        return try {
            val done = when (action) {
                "speak" -> { playUrl(arg); "Spoken on the phone." }
                "say" -> { say(arg); "Spoken on the phone." }
                "torch" -> { val on = arg.trim().equals("on", true); torch(on); "Torch ${if (on) "on" else "off"}." }
                "volume" -> volume(arg)
                "media" -> { media(arg.trim().lowercase()); "Media ${arg.trim()} sent." }
                "open_url" -> { openUri(Uri.parse(arg.trim())); "Opened the link on the phone." }
                "open_app" -> openApp(arg.trim())
                "ring" -> { ring(); "The phone is ringing for 30 seconds." }
                "stop_ring" -> { stopRing(); "Stopped ringing." }
                "dnd" -> { val on = arg.trim().equals("on", true); dnd(on); "Do Not Disturb ${if (on) "on" else "off"}." }
                "brightness" -> { brightness(arg.trim()); "Brightness set." }
                "wa_call" -> waCall(arg.trim(), video = false)
                "wa_video" -> waCall(arg.trim(), video = true)
                "wa_message" -> waMessage(arg)
                "firetv" -> FireTv.run(ctx, arg)
                "note" -> openNote(arg)
                "come_back" -> { start(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)); "Bernard is back on screen." }
                else -> throw Fail("The phone app doesn't know '$action' yet.")
            }
            true to done
        } catch (e: Fail) {
            false to (e.message ?: "That didn't work.")
        } catch (e: Exception) {
            Log.e(tag, "failed $action", e)
            false to "That didn't work on the phone: ${e.javaClass.simpleName} ${e.message ?: ""}".trim()
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
                setOnErrorListener { mp, _, _ -> mp.release(); if (player === mp) player = null; true }
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
        val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true } ?: throw Fail("This phone has no torch.")
        cm.setTorchMode(id, on)
    }

    private fun volume(arg: String): String {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val cur = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
        val a = arg.trim().lowercase()
        val target = when {
            a.startsWith("up") -> cur + max / 5
            a.startsWith("down") -> cur - max / 5
            a.toIntOrNull() != null -> Math.round(a.toInt() * max / 15f)
            else -> throw Fail("Volume needs a number from 0 to 15, or up or down.")
        }
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, target.coerceIn(0, max), AudioManager.FLAG_SHOW_UI)
        return "Media volume set."
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
        if (!nm.isNotificationPolicyAccessGranted) throw Fail("The Bernard app needs Do Not Disturb access. Allow it in Settings, Apps, Bernard.")
        nm.setInterruptionFilter(if (on) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL)
    }

    private fun brightness(arg: String) {
        if (!Settings.System.canWrite(ctx)) throw Fail("The Bernard app needs permission to modify system settings for brightness.")
        val v = arg.toIntOrNull()?.coerceIn(1, 255) ?: throw Fail("Brightness needs a number from 1 to 255.")
        Settings.System.putInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
        Settings.System.putInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS, v)
    }

    // ---- apps ----
    private fun start(i: Intent) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (!Settings.canDrawOverlays(ctx)) throw Fail("The Bernard app needs 'Display over other apps' switched on to open apps and calls. It's in Settings, Apps, Bernard.")
        ctx.startActivity(i)
    }

    private fun openUri(u: Uri) = start(Intent(Intent.ACTION_VIEW, u))

    // Opens a new note (Samsung Notes, else Google Keep, else a pick-an-app list) with the text filled in.
    private fun openNote(text: String): String {
        if (text.isBlank()) throw Fail("There's nothing to put in the note.")
        val base = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, text).putExtra(Intent.EXTRA_SUBJECT, text.lineSequence().first().take(60))
        for ((pkg, name) in listOf("com.samsung.android.app.notes" to "Samsung Notes", "com.google.android.keep" to "Google Keep")) {
            val i = Intent(base).setPackage(pkg)
            if (i.resolveActivity(ctx.packageManager) != null) { start(i); return "Opened it in $name. Tap save there to keep it." }
        }
        start(Intent.createChooser(base, "Save the list in…"))
        return "Opened the phone's share list: pick your notes app."
    }

    private fun openApp(name: String): String {
        val pm = ctx.packageManager
        val q = name.lowercase().removeSuffix(" app").trim()
        val apps = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), PackageManager.MATCH_ALL)
        val label = { r: android.content.pm.ResolveInfo -> r.loadLabel(pm).toString().lowercase() }
        val hit = apps.firstOrNull { label(it) == q } ?: apps.firstOrNull { label(it).startsWith(q) } ?: apps.firstOrNull { label(it).contains(q) }
        if (hit == null) throw Fail("There's no app called $name on the phone.")
        start(pm.getLaunchIntentForPackage(hit.activityInfo.packageName) ?: throw Fail("$name can't be opened."))
        return "Opened ${hit.loadLabel(pm)}."
    }

    // ---- WhatsApp ----
    private fun contactRow(mime: String, name: String, column: String): String? {
        if (ctx.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            throw Fail("The Bernard app needs access to contacts. Allow it in Settings, Apps, Bernard, Permissions.")
        }
        val like = "%" + name.replace("'", "_") + "%"
        ctx.contentResolver.query(
            ContactsContract.Data.CONTENT_URI, arrayOf(column),
            "${ContactsContract.Data.MIMETYPE}=? AND ${ContactsContract.Data.DISPLAY_NAME} LIKE ?",
            arrayOf(mime, like), "${ContactsContract.Data.DISPLAY_NAME} ASC"
        )?.use { c -> if (c.moveToFirst()) return c.getString(0) }
        return null
    }

    private fun waCall(name: String, video: Boolean): String {
        if (ctx.checkSelfPermission(android.Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED)
            throw Fail("The Bernard app needs the Phone permission to start WhatsApp calls. Open the Bernard app and tap Allow, or turn on Phone in Settings, Apps, Bernard, Permissions.")
        val mime = if (video) "vnd.android.cursor.item/vnd.com.whatsapp.video.call" else "vnd.android.cursor.item/vnd.com.whatsapp.voip.call"
        val id = contactRow(mime, name, ContactsContract.Data._ID) ?: throw Fail("I couldn't find $name in the phone's contacts with WhatsApp. Check how the contact is saved.")
        if (!Settings.canDrawOverlays(ctx)) throw Fail("The Bernard app needs 'Display over other apps' switched on to open apps and calls. It's in Settings, Apps, Bernard.")
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://com.android.contacts/data/$id"), mime).setPackage("com.whatsapp")
        // Bernard's own conversation holds the mic and speaker: end it and free the mic before the call starts,
        // otherwise WhatsApp connects with no sound.
        main.post { WakeWord.holdForCall(); Bus.endTalk?.invoke() }
        main.postDelayed({ try { start(intent) } catch (e: Exception) { Log.e(tag, "call start failed", e) } }, 2500)
        return "Starting the WhatsApp ${if (video) "video" else "voice"} call to $name in two seconds. Our conversation ends now so the call gets the microphone: just say a very short goodbye like 'Calling $name now.'"
    }

    private fun waMessage(arg: String): String {
        val parts = arg.split("::", limit = 2)
        val name = parts[0].trim()
        val text = parts.getOrElse(1) { "" }   // already URL-encoded by the server
        val jid = contactRow("vnd.android.cursor.item/vnd.com.whatsapp.profile", name, ContactsContract.Data.DATA1)
            ?: throw Fail("I couldn't find $name in the phone's contacts with WhatsApp. Check how the contact is saved.")
        val number = jid.substringBefore("@").filter { it.isDigit() }
        start(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$number?text=$text")).setPackage("com.whatsapp"))
        return "WhatsApp chat with $name opened with the message typed in. He needs to tap send."
    }
}
