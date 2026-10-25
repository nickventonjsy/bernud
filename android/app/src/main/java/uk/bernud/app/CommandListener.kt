package uk.bernud.app

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

private const val SERVER = "https://bernud-server.onrender.com"

private fun http(method: String, path: String, secret: String, body: JSONObject? = null, readTimeoutMs: Int = 15_000): Pair<Int, String> {
    val c = URL(SERVER + path).openConnection() as HttpURLConnection
    try {
        c.requestMethod = method
        c.connectTimeout = 15_000
        c.readTimeout = readTimeoutMs
        c.setRequestProperty("x-phone-key", secret)
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("content-type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val code = c.responseCode
        val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        return code to text
    } finally { c.disconnect() }
}

// Tell the server what happened (so problems can be diagnosed remotely).
fun ackToServer(secret: String, event: String, action: String = "", ok: Boolean = true, detail: String = "") {
    Thread {
        try { http("POST", "/device/phone/ack", secret, JSONObject().put("event", event).put("action", action).put("ok", ok).put("detail", detail)) } catch (_: Exception) {}
    }.start()
}

// Collects Bernard's phone commands straight from his server (long-poll, like the PC helper),
// runs each one and reports the result so Bernard can tell Nicholas what actually happened.
// The secret comes from the server via the dashboard passcode, never baked into the app.
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
        val secret = ctx.getSharedPreferences("bernud", Context.MODE_PRIVATE).getString("cmdSecret", null) ?: return
        running = true
        commands = PhoneCommands(ctx)
        thread = Thread({ loop(secret) }, "bernud-commands").apply { isDaemon = true; start() }
    }

    fun stop() {
        running = false
        thread?.interrupt(); thread = null
        commands?.shutdown(); commands = null
        connected = false
    }

    private fun loop(secret: String) {
        var backoff = 2_000L
        var announced = false
        while (running) {
            try {
                val (code, text) = http("GET", "/device/phone/poll", secret, readTimeoutMs = 40_000)
                if (code == 401) { connected = false; Log.w(tag, "secret rejected"); Thread.sleep(60_000); continue }
                if (code != 200) throw Exception("HTTP $code")
                if (!connected && !announced) { ackToServer(secret, "connected"); announced = true }
                connected = true
                backoff = 2_000L
                val cmd = JSONObject(text).optJSONObject("command") ?: continue
                val id = cmd.optString("id")
                val (ok, output) = commands?.handle(cmd.optString("action"), cmd.optString("target")) ?: (false to "Phone app stopping.")
                try { http("POST", "/device/phone/result", secret, JSONObject().put("id", id).put("ok", ok).put("output", output)) } catch (e: Exception) { Log.w(tag, "result: ${e.message}") }
            } catch (e: InterruptedException) {
                break
            } catch (e: Exception) {
                connected = false
                if (!running) break
                Log.w(tag, "poll: ${e.message}")
                try { Thread.sleep(backoff) } catch (_: InterruptedException) { break }
                backoff = (backoff * 2).coerceAtMost(30_000L)
            }
        }
    }
}
