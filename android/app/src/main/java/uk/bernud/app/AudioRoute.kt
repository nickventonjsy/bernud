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
    private val personal = setOf(
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_USB_HEADSET, 26 /* TYPE_BLE_HEADSET */, 27 /* TYPE_BLE_SPEAKER */
    )

    fun conversationStarted(ctx: Context) {
        // WebRTC switches the audio mode a moment after connecting, so apply a few times.
        for (delay in longArrayOf(300, 1200, 3000)) main.postDelayed({ toSpeaker(ctx) }, delay)
    }

    fun conversationEnded(ctx: Context) {
        val am = ctx.getSystemService(AudioManager::class.java) ?: return
        try {
            if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice()
            else @Suppress("DEPRECATION") { am.isSpeakerphoneOn = false }
        } catch (_: Exception) {}
    }

    private fun toSpeaker(ctx: Context) {
        val am = ctx.getSystemService(AudioManager::class.java) ?: return
        try {
            val outs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            if (outs.any { it.type in personal }) return   // headphones / car: leave the route alone
            if (Build.VERSION.SDK_INT >= 31) {
                am.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                    ?.let { am.setCommunicationDevice(it) }
            } else {
                @Suppress("DEPRECATION")
                am.isSpeakerphoneOn = true
            }
            val max = am.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL)
            if (am.getStreamVolume(AudioManager.STREAM_VOICE_CALL) < max * 0.6) {
                am.setStreamVolume(AudioManager.STREAM_VOICE_CALL, (max * 0.8).toInt(), 0)
            }
        } catch (_: Exception) {}
    }
}
