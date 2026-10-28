package uk.bernud.app

import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent

// Music Bernard starts on this phone (Spotify) is held while Nicholas is talking to Bernard through the phone:
// the conversation takes the phone's audio, and Spotify pauses. This presses Play for Spotify once the conversation ends.
object MusicResume {
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var armedUntil = 0L
    @Volatile var inConversation = false

    // Called when Bernard has just started music on the phone. Returns true if it will start after the conversation.
    fun musicStarted(ctx: Context): Boolean {
        if (inConversation) { armedUntil = System.currentTimeMillis() + 10 * 60_000; return true }
        main.postDelayed({ play(ctx) }, 1200)   // not talking to Bernard here: just make sure it isn't sitting paused
        return false
    }

    fun conversationStarted() { inConversation = true }
    fun conversationEnded(ctx: Context) {
        inConversation = false
        if (System.currentTimeMillis() < armedUntil) { armedUntil = 0; main.postDelayed({ play(ctx) }, 1500); main.postDelayed({ play(ctx) }, 4000) }
    }

    private fun play(ctx: Context) {
        val am = ctx.getSystemService(AudioManager::class.java) ?: return
        if (am.isMusicActive) return
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PLAY))
    }
}
