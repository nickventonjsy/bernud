package uk.bernud.app

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper

// Live voice chats on Android default to the quiet earpiece. While talking to Bernard, send his voice
// to the loudspeaker instead (unless headphones, earbuds or a car are connected), and make sure the
// in-call volume isn't near zero.
object AudioRoute {
    private val main = Handler(Looper.getMainLooper())
    // Things Nicholas might actually be listening through. Bluetooth hands-free (SCO) is deliberately NOT here:
    // a Galaxy Watch registers as a hands-free device, and treating it as headphones sent Bernard's voice to the
    // quiet earpiece. Cars and earbuds also offer A2DP, so they are still recognised.
    private val personal = setOf(
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_USB_HEADSET, 26 /* TYPE_BLE_HEADSET */
    )
    private val wearable = Regex("watch|band|fit\\b|wear", RegexOption.IGNORE_CASE)
    private var active = false
    private var keep: Runnable? = null

    fun conversationStarted(ctx: Context) {
        active = true
        // WebRTC switches the audio mode a moment after connecting (and sometimes again later), so keep re-applying
        // the loudspeaker every couple of seconds for the whole conversation.
        keep?.let { main.removeCallbacks(it) }
        val r = object : Runnable { override fun run() { if (!active) return; toSpeaker(ctx); main.postDelayed(this, 2000) } }
        keep = r; main.postDelayed(r, 300)
    }

    fun conversationEnded(ctx: Context) {
        active = false
        keep?.let { main.removeCallbacks(it) }; keep = null
        val am = ctx.getSystemService(AudioManager::class.java) ?: return
        try {
            if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice() else legacySpeaker(am, false)
        } catch (_: Exception) {}
    }

    @Suppress("DEPRECATION")
    private fun legacySpeaker(am: AudioManager, on: Boolean) { am.isSpeakerphoneOn = on }

    private fun toSpeaker(ctx: Context) {
        val am = ctx.getSystemService(AudioManager::class.java) ?: return
        try {
            val outs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            val listening = outs.filter { it.type in personal && !wearable.containsMatchIn(it.productName ?: "") }
            if (listening.isNotEmpty()) return   // headphones / earbuds / car: leave the route alone
            if (Build.VERSION.SDK_INT >= 31) {
                am.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                    ?.let { am.setCommunicationDevice(it) }
            } else legacySpeaker(am, true)
            val max = am.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL)
            if (am.getStreamVolume(AudioManager.STREAM_VOICE_CALL) < max * 0.6) {
                am.setStreamVolume(AudioManager.STREAM_VOICE_CALL, (max * 0.8).toInt(), 0)
            }
        } catch (_: Exception) {}
    }
}
