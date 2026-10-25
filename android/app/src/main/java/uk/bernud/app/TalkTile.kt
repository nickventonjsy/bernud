package uk.bernud.app

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.TileService

// Quick-settings tile: swipe down from any app and tap "Talk to Bernard".
class TalkTile : TileService() {
    override fun onClick() {
        super.onClick()
        val talk = Bus.talk
        if (talk != null) { talk(); return }
        val intent = Intent(this, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_TALK, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 3, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}
