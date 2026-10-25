package uk.bernud.app

import android.content.Context
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
    private val GRAMMAR = """["hey bernard", "hey", "bernard", "hello", "okay", "hey there", "[unk]"]"""
    private val main = Handler(Looper.getMainLooper())

    private var model: Model? = null
    private var recognizer: Recognizer? = null
    private var service: SpeechService? = null
    private var wanted = false          // service is running and wants to listen
    private var inConversation = false
    private var loading = false
    private val resumeIfNoConversation = Runnable { if (!inConversation) listen() }

    var status: String = "starting"
        private set

    fun start(ctx: Context) {
        wanted = true
        if (model != null) { listen(); return }
        if (loading) return
        loading = true
        status = "loading"
        StorageService.unpack(ctx.applicationContext, "model-en-us", "model",
            { m ->
                loading = false
                model = m
                recognizer = Recognizer(m, 16000.0f, GRAMMAR)
                if (wanted && !inConversation) listen()
            },
            { e ->
                loading = false
                status = "error: ${e.message}"
                Log.e(TAG, "model load failed", e)
            })
    }

    fun stop() {
        wanted = false
        release()
        status = "off"
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
        try {
            r.reset()
            service = SpeechService(r, 16000.0f).also { it.startListening(this) }
            status = "listening"
        } catch (e: Exception) {
            status = "mic busy"
            Log.e(TAG, "listen failed", e)
            service = null
            main.postDelayed({ listen() }, 5000)
        }
    }

    private fun release() {
        service?.let { try { it.stop(); it.shutdown() } catch (_: Exception) {} }
        service = null
        if (wanted) status = if (inConversation) "paused (talking)" else "paused"
    }

    private fun heard(json: String?, key: String) {
        val text = try { JSONObject(json ?: "{}").optString(key) } catch (_: Exception) { "" }
        if (!text.contains("hey bernard")) return
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
