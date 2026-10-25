package uk.bernud.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

// Keeps Bernard alive with microphone access while Nicholas uses other apps.
// Android only lets a backgrounded app use the mic while a "microphone" foreground service is running.
class BernudService : Service() {
    companion object {
        const val ACTION_TALK = "uk.bernud.app.TALK"
        const val ACTION_STOP = "uk.bernud.app.STOP"
        private const val CHANNEL = "bernud"
        private const val ID = 7
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Bernard", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Keeps Bernard listening while you use other apps"
            setShowBadge(false)
        })
        val n = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        else startForeground(ID, n)
        wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "bernud:listening").apply { setReferenceCounted(false); acquire() }
        if (getSharedPreferences("bernud", MODE_PRIVATE).getBoolean("wakeWord", true)) WakeWord.start(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_TALK -> Handler(Looper.getMainLooper()).post { Bus.talk?.invoke() }
            ACTION_STOP -> {
                Handler(Looper.getMainLooper()).post { Bus.finish?.invoke() }
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        WakeWord.stop()
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), flags)
        val talk = PendingIntent.getService(this, 1, Intent(this, BernudService::class.java).setAction(ACTION_TALK), flags)
        val stop = PendingIntent.getService(this, 2, Intent(this, BernudService::class.java).setAction(ACTION_STOP), flags)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("Bernard is ready")
            .setContentText("Say \"Hey Bernard\", or tap Talk")
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Talk", talk).build())
            .addAction(Notification.Action.Builder(null, "Close Bernard", stop).build())
            .build()
    }
}
