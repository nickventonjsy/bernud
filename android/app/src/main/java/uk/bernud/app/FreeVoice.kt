package uk.bernud.app

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONObject
import java.util.Locale

// Bernard's free mode on the phone: Android's own speech recognition (listening) and text-to-speech (speaking).
// Both are built into the phone and cost nothing. Results go back to the dashboard as JavaScript callbacks.
class FreeVoice(private val activity: MainActivity, private val js: (String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeech: String? = null
    private var busyRetries = 0

    private fun call(fn: String, arg: String?) = js("window.$fn && window.$fn(${if (arg == null) "null" else JSONObject.quote(arg)})")

    fun listenOnce() = main.post {
        stopListening()
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) { call("bernudHeard", null); return@post }
        // Give the wake word a moment to let go of the microphone.
        main.postDelayed({ startRecognizer() }, 300)
    }

    private fun startRecognizer() {
        val r = SpeechRecognizer.createSpeechRecognizer(activity)
        recognizer = r
        r.setRecognitionListener(object : android.speech.RecognitionListener {
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
                busyRetries = 0; release(); call("bernudHeard", text)
            }
            override fun onPartialResults(partial: Bundle?) {
                val text = partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
                if (text.isNotBlank()) call("bernudPartial", text)
            }
            override fun onError(error: Int) {
                release()
                if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY && busyRetries++ < 2) { main.postDelayed({ startRecognizer() }, 500); return }
                busyRetries = 0
                call("bernudHeard", "")
            }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-GB")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.packageName)
        }
        try { r.startListening(intent) } catch (_: Exception) { release(); call("bernudHeard", "") }
    }

    private fun release() { try { recognizer?.destroy() } catch (_: Exception) {}; recognizer = null }
    fun stopListening() = main.post { try { recognizer?.cancel() } catch (_: Exception) {}; release() }

    fun speak(text: String) = main.post {
        val t = tts
        if (t == null) {
            pendingSpeech = text
            tts = TextToSpeech(activity) { status ->
                ttsReady = status == TextToSpeech.SUCCESS
                if (ttsReady) {
                    tts?.language = Locale.UK
                    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(id: String?) {}
                        override fun onDone(id: String?) { main.post { call("bernudSpoke", "") } }
                        @Deprecated("Deprecated in Java") override fun onError(id: String?) { main.post { call("bernudSpoke", "") } }
                        override fun onStop(id: String?, interrupted: Boolean) { main.post { call("bernudSpoke", "") } }
                    })
                    pendingSpeech?.let { say(it) }
                } else call("bernudSpoke", "")
                pendingSpeech = null
            }
            return@post
        }
        if (!ttsReady) { call("bernudSpoke", ""); return@post }
        say(text)
    }

    private fun say(text: String) {
        val r = tts?.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), "bernud-" + System.currentTimeMillis())
        if (r != TextToSpeech.SUCCESS) call("bernudSpoke", "")
    }

    fun stopSpeaking() = main.post { try { tts?.stop() } catch (_: Exception) {} }

    fun destroy() { release(); try { tts?.shutdown() } catch (_: Exception) {}; tts = null }
}
