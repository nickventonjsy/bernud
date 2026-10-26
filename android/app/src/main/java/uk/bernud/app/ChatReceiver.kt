package uk.bernud.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

// Replies to the Bernard conversation (Android Auto voice reply, watch, or the notification on the phone).
class ChatReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            CarChat.ACTION_START -> CarChat.start(ctx)
            CarChat.ACTION_READ -> {}
            CarChat.ACTION_REPLY -> {
                val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(CarChat.KEY_REPLY)?.toString()?.trim()
                if (text.isNullOrEmpty()) return
                val app = ctx.applicationContext
                CarChat.add(app, text, fromBernard = false)
                val pending = goAsync()
                Thread {
                    try { CarChat.add(app, BrainClient.ask(app, text, "car"), fromBernard = true) }
                    finally { pending.finish() }
                }.start()
            }
        }
    }
}
