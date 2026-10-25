package uk.bernud.app

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

// Tell the server what happened (so problems can be diagnosed remotely).
fun ackToServer(secret: String, event: String, action: String = "", ok: Boolean = true, detail: String = "") {
    Thread {
        try {
            val c = URL("https://bernud-server.onrender.com/device/phone/ack").openConnection() as HttpURLConnection
            c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 10_000; c.readTimeout = 10_000
            c.setRequestProperty("content-type", "application/json"); c.setRequestProperty("x-phone-key", secret)
            c.outputStream.use { it.write(JSONObject().put("event", event).put("action", action).put("ok", ok).put("detail", detail).toString().toByteArray()) }
            c.responseCode; c.disconnect()
        } catch (_: Exception) {}
    }.start()
}

// Listens on Bernard's private ntfy command topic and runs each command on the phone.
// The topic and secret come from the server (via the dashboard passcode), never baked into the app.
class CommandListener(private val ctx: Context) {
    private val tag = "BernudCmd"
    @Volatile private var running = false
    private var thread: Thread? = null
    private var commands: PhoneCommands? = null
    @Volatile var connected = false
        private set
    val status: String get() = if (!running) "not linked" else if (connected) "connected" else "connecting"

    fun start() {
        if (running) return
        val prefs = ctx.getSharedPreferences("bernud", Context.MODE_PRIVATE)
        val topic = prefs.getString("cmdTopic", null) ?: return
        val secret = prefs.getString("cmdSecret", null) ?: return
        running = true
        commands = PhoneCommands(ctx) { action, ok, detail -> ackToServer(secret, "command", action, ok, detail) }
        thread = Thread({ loop(topic, secret) }, "bernud-commands").apply { isDaemon = true; start() }
    }

    fun stop() {
        running = false
        thread?.interrupt(); thread = null
        commands?.shutdown(); commands = null
        connected = false
    }

    private fun loop(topic: String, secret: String) {
        var since = "10s"   // catch a command sent while (re)connecting, but not old ones
        var backoff = 2_000L
        val seen = LinkedHashSet<String>()
        while (running) {
            var conn: HttpURLConnection? = null
            try {
                conn = (URL("https://ntfy.sh/${URLEncoder.encode(topic, "UTF-8")}/json?since=$since").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15_000
                    readTimeout = 90_000   // ntfy sends keepalives every ~45s
                }
                BufferedReader(InputStreamReader(conn.inputStream)).use { r ->
                    if (!connected) ackToServer(secret, "connected")
                    connected = true
                    backoff = 2_000L
                    while (running) {
                        val line = r.readLine() ?: break
                        val j = try { JSONObject(line) } catch (_: Exception) { continue }
                        if (j.optString("event") != "message") continue
                        val id = j.optString("id")
                        since = id.ifEmpty { since }
                        if (!seen.add(id)) continue
                        if (seen.size > 200) seen.remove(seen.first())
                        val parts = j.optString("message").split("|", limit = 3)
                        if (parts.size < 2 || parts[0] != secret) continue
                        commands?.handle(parts[1], parts.getOrElse(2) { "" })
                    }
                }
            } catch (e: Exception) {
                if (running) { Log.w(tag, "stream: ${e.message}"); ackToServer(secret, "stream_error", ok = false, detail = e.toString()) }
            } finally {
                connected = false
                conn?.disconnect()
            }
            if (running) { try { Thread.sleep(backoff) } catch (_: InterruptedException) { break }; backoff = (backoff * 2).coerceAtMost(60_000L) }
        }
    }
}
