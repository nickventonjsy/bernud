package uk.bernud.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

// Presses Send in WhatsApp, but only in a short window after Nicholas has approved a message out loud.
// Bernard opens the chat with the message typed in (wa.me link); this service then taps the Send button once.
class SendHelper : AccessibilityService() {
    companion object {
        private const val TAG = "BernudSend"
        @Volatile var armedUntil = 0L          // when > now, the next WhatsApp Send button gets pressed
        @Volatile var sent = false             // set once the button was pressed
        @Volatile var running = false
        fun arm(ms: Long = 12_000) { armedUntil = System.currentTimeMillis() + ms; sent = false }
        fun disarm() { armedUntil = 0 }
        fun enabled(ctx: Context): Boolean {
            val on = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            return on.split(':').any { it.contains(ctx.packageName + "/") && it.endsWith(SendHelper::class.java.name) }
        }
    }

    override fun onServiceConnected() { running = true; Log.i(TAG, "connected") }
    override fun onInterrupt() {}
    override fun onDestroy() { running = false; super.onDestroy() }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (sent || System.currentTimeMillis() > armedUntil) return
        val root = rootInActiveWindow ?: return
        try {
            // WhatsApp's send button: id "send", content description "Send".
            val byId = root.findAccessibilityNodeInfosByViewId("com.whatsapp:id/send") + root.findAccessibilityNodeInfosByViewId("com.whatsapp.w4b:id/send")
            val node = byId.firstOrNull { it.isVisibleToUser } ?: findByDescription(root, "Send")
            if (node != null && node.isEnabled) {
                val clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK) || (node.parent?.performAction(AccessibilityNodeInfo.ACTION_CLICK) ?: false)
                if (clicked) { sent = true; armedUntil = 0; Log.i(TAG, "pressed send") }
            }
        } catch (e: Exception) { Log.w(TAG, "send check failed", e) }
    }

    private fun findByDescription(node: AccessibilityNodeInfo, text: String): AccessibilityNodeInfo? {
        if (node.contentDescription?.toString()?.equals(text, ignoreCase = true) == true && node.isVisibleToUser && node.isClickable) return node
        for (i in 0 until node.childCount) { val c = node.getChild(i) ?: continue; findByDescription(c, text)?.let { return it } }
        return null
    }
}
