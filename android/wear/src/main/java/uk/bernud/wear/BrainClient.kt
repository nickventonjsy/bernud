package uk.bernud.wear

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// Same as the phone's: asks Bernard's free brain and returns his reply.
object BrainClient {
    private const val SERVER = "https://bernud-server.onrender.com"

    fun ask(ctx: Context, text: String): String {
        val key = ctx.getSharedPreferences("bernud", Context.MODE_PRIVATE).getString("dashKey", null)
            ?: return "Open Bernard on your phone once, so it can pass me your passcode, then try again."
        return try {
            val c = URL("$SERVER/brain/chat").openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.connectTimeout = 15_000
            c.readTimeout = 45_000
            c.doOutput = true
            c.setRequestProperty("content-type", "application/json")
            c.setRequestProperty("x-dashboard-key", key)
            c.outputStream.use { it.write(JSONObject().put("text", text).put("session", "watch").toString().toByteArray()) }
            if (c.responseCode == 401) return "My passcode's out of date. Open Bernard on your phone so it can send the new one."
            val body = (if (c.responseCode < 400) c.inputStream else c.errorStream).bufferedReader().use { it.readText() }
            JSONObject(body).optString("reply").ifBlank { "Sorry, I didn't get an answer that time." }
        } catch (e: Exception) {
            "I couldn't reach my server. Check the watch is connected to your phone or Wi-Fi."
        }
    }
}
