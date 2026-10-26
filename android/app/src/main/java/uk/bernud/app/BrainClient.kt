package uk.bernud.app

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// Talks to Bernard's free brain directly (no WebView): used by the car conversation.
object BrainClient {
    private const val SERVER = "https://bernud-server.onrender.com"

    fun ask(ctx: Context, text: String, session: String): String {
        val key = ctx.getSharedPreferences("bernud", Context.MODE_PRIVATE).getString("dashKey", null)
            ?: return "I need your passcode first. Open Bernard on your phone once and enter it, then try again."
        return try {
            val c = URL("$SERVER/brain/chat").openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.connectTimeout = 15_000
            c.readTimeout = 45_000
            c.doOutput = true
            c.setRequestProperty("content-type", "application/json")
            c.setRequestProperty("x-dashboard-key", key)
            c.outputStream.use { it.write(JSONObject().put("text", text).put("session", session).toString().toByteArray()) }
            if (c.responseCode == 401) return "My passcode's out of date. Open Bernard on your phone and enter it again."
            val body = (if (c.responseCode < 400) c.inputStream else c.errorStream).bufferedReader().use { it.readText() }
            JSONObject(body).optString("reply").ifBlank { "Sorry, I didn't get an answer that time." }
        } catch (e: Exception) {
            "I couldn't reach my server just now. Check you've got signal and try again."
        }
    }
}
