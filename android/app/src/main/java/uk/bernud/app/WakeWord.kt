package uk.bernud.app

import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService

// Offline "Hey Bernard" wake word (Vosk, small English model bundled in the app; nothing leaves the phone).
// Runs inside the microphone foreground service, so it also works while other apps are open.
// It releases the mic while a conversation is running, because only one recorder can use it at a time.
object WakeWord : RecognitionListener {
    private const val TAG = "BernudWake"
    private val GRAMMAR = """["hey bernard", "hey bernie", "hey barnard", "hey bernhard", "okay bernard", "bernard", "hey", "hello", "okay", "hey there", "[unk]"]"""
    private val TRIGGER = Regex("\\b(bernard|bernie|barnard|bernhard)\\b")
    private val main = Handler(Looper.getMainLooper())

    private var model: Model? = null
    private var recognizer: Recognizer? = null
    private var service: SpeechService? = null
    private var wanted = false          // service is running and wants to listen
    private var inConversation = false
    private var loading = false
    private val resumeIfNoConversation = Runnable { if (!inConversation) listen() }

    private var state: String = "starting"
    private var lastHeard: String = ""
    private var heardCount = 0
    val status: String get() = if (state == "listening") "listening · heard ${heardCount}x" + (if (lastHeard.isNotEmpty()) " · last: \"$lastHeard\"" else "") else state

    private var audio: AudioManager? = null
    private var holdUntil = 0L   // keep quiet until then (a call is being started)

    // Another app is on a call (phone, WhatsApp...) when the audio mode says so and we're not talking ourselves.
    private fun callInProgress(): Boolean {
        val m = audio?.mode ?: return false
        return !inConversation && (m == AudioManager.MODE_IN_CALL || m == AudioManager.MODE_IN_COMMUNICATION || m == AudioManager.MODE_RINGTONE || m == AudioManager.MODE_CALL_SCREENING)
    }

    // Checks every few seconds: gives the mic up the moment a call starts, takes it back after it ends.
    private val callWatch = object : Runnable {
        override fun run() {
            if (!wanted) return
            val busy = callInProgress() || System.currentTimeMillis() < holdUntil
            if (busy && service != null) { release(); state = "paused (call in progress)" }
            else if (!busy && service == null && !inConversation && !loading && recognizer != null) listen()
            main.postDelayed(this, 3000)
        }
    }

    // Called just before Bernard starts a WhatsApp call: release the mic and stay quiet for a while.
    fun holdForCall(ms: Long = 20_000) {
        holdUntil = System.currentTimeMillis() + ms
        release()
        state = "paused (call in progress)"
    }

    fun start(ctx: Context) {
        wanted = true
        audio = ctx.applicationContext.getSystemService(AudioManager::class.java)
        main.removeCallbacks(callWatch)
        main.postDelayed(callWatch, 3000)
        if (model != null) { listen(); return }
        if (loading) return
        loading = true
        state = "loading"
        StorageService.unpack(ctx.applicationContext, "model-en-us", "model",
            { m ->
                loading = false
                model = m
                recognizer = Recognizer(m, 16000.0f, GRAMMAR)
                if (wanted && !inConversation) listen()
            },
            { e ->
                loading = false
                state = "error: ${e.message}"
                Log.e(TAG, "model load failed", e)
            })
    }

    fun stop() {
        wanted = false
        main.removeCallbacks(callWatch)
        release()
        state = "off"
    }

    // Called from the dashboard (JavaScript bridge).
    fun conversationStarted() {
        inConversation = true
        main.removeCallbacks(resumeIfNoConversation)
        release()
    }

    fun conversationEnded() {
        inConversation = false
        main.removeCallbacks(resumeIfNoConversation)
        main.postDelayed({ if (wanted && !inConversation) listen() }, 800)
    }

    private fun listen() {
        val r = recognizer ?: return
        if (!wanted || inConversation || service != null) return
        if (callInProgress() || System.currentTimeMillis() < holdUntil) { state = "paused (call in progress)"; return }
        try {
            r.reset()
            service = SpeechService(r, 16000.0f).also { it.startListening(this) }
            state = "listening"
        } catch (e: Exception) {
            state = "mic busy"
            Log.e(TAG, "listen failed", e)
            service = null
            main.postDelayed({ listen() }, 5000)
        }
    }

    private fun release() {
        service?.let { try { it.stop(); it.shutdown() } catch (_: Exception) {} }
        service = null
        if (wanted) state = if (inConversation) "paused (talking)" else "paused"
    }

    private fun heard(json: String?, key: String) {
        val text = try { JSONObject(json ?: "{}").optString(key) } catch (_: Exception) { "" }
        if (text.isNotBlank() && key == "text") { heardCount++; lastHeard = text.take(40) }
        if (!TRIGGER.containsMatchIn(text)) return
        main.post {
            if (inConversation || service == null) return@post
            release()
            Bus.wake?.invoke()
            // If the dashboard never reports a conversation starting, start listening again.
            main.removeCallbacks(resumeIfNoConversation)
            main.postDelayed(resumeIfNoConversation, 15_000)
        }
    }

    override fun onPartialResult(hypothesis: String?) = heard(hypothesis, "partial")
    override fun onResult(hypothesis: String?) = heard(hypothesis, "text")
    override fun onFinalResult(hypothesis: String?) = heard(hypothesis, "text")
    override fun onError(exception: Exception?) {
        Log.e(TAG, "recogniser error", exception)
        release()
        main.postDelayed({ listen() }, 3000)
    }
    override fun onTimeout() { release(); listen() }
}
