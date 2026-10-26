package uk.bernud.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput

// Bernard as a messaging conversation. Android Auto reads his messages aloud and lets Nicholas reply by voice;
// the same conversation also shows on the phone and the watch, where you can reply too.
object CarChat {
    const val CHANNEL = "bernard_chat"
    const val KEY_REPLY = "reply"
    const val ACTION_REPLY = "uk.bernud.app.CHAT_REPLY"
    const val ACTION_READ = "uk.bernud.app.CHAT_READ"
    const val ACTION_START = "uk.bernud.app.CHAT_START"
    private const val ID = 42
    private val me = Person.Builder().setName("Nicholas").setKey("me").build()
    private val bernard = Person.Builder().setName("Bernard").setKey("bernard").setBot(true).build()
    private data class Msg(val text: String, val time: Long, val fromBernard: Boolean)
    private val messages = mutableListOf<Msg>()

    fun start(ctx: Context, hello: String = "I'm here, Nicholas. Reply to talk to me.") {
        messages.clear()
        add(ctx, hello, fromBernard = true)
    }

    @Synchronized
    fun add(ctx: Context, text: String, fromBernard: Boolean, silent: Boolean = !fromBernard) {
        messages += Msg(text, System.currentTimeMillis(), fromBernard)
        while (messages.size > 12) messages.removeAt(0)
        post(ctx, silent)
    }

    fun clear(ctx: Context) {
        messages.clear()
        NotificationManagerCompat.from(ctx).cancel(ID)
    }

    private fun post(ctx: Context, silent: Boolean) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Bernard chat", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Talk to Bernard by replying, in the car (Android Auto), on your watch or here"
            })
        }
        val style = NotificationCompat.MessagingStyle(me)
        for (m in messages) style.addMessage(m.text, m.time, if (m.fromBernard) bernard else me)

        val replyIntent = Intent(ctx, ChatReceiver::class.java).setAction(ACTION_REPLY)
        val replyPi = PendingIntent.getBroadcast(ctx, 10, replyIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
        val reply = NotificationCompat.Action.Builder(R.drawable.ic_notify, "Reply", replyPi)
            .addRemoteInput(RemoteInput.Builder(KEY_REPLY).setLabel("Talk to Bernard").build())
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .setAllowGeneratedReplies(true)
            .build()
        val readPi = PendingIntent.getBroadcast(ctx, 11, Intent(ctx, ChatReceiver::class.java).setAction(ACTION_READ), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val read = NotificationCompat.Action.Builder(R.drawable.ic_notify, "Mark as read", readPi)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build()
        val open = PendingIntent.getActivity(ctx, 12, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setStyle(style)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(open)
            .addAction(reply)
            .addInvisibleAction(read)
            .setSilent(silent)
            .setOnlyAlertOnce(false)
            .setAutoCancel(false)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(ID, n) } catch (_: SecurityException) {}
    }
}
