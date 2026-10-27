package uk.bernud.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

// Bernard's free mode on the phone: Android's own speech recognition (listening) and text-to-speech (speaking).
// Both are built into the phone and cost nothing. Results go back to the dashboard as JavaScript callbacks.
class FreeVoice(private val activity: MainActivity, private val js: (String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private val waiting = mutableListOf<() -> Unit>()
    private var busyRetries = 0
    private val prefs = activity.getSharedPreferences("bernud", Context.MODE_PRIVATE)

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

    // Start the phone's text-to-speech once, then run whatever was waiting for it.
    private fun withTts(then: () -> Unit) {
        if (tts != null && ttsReady) { then(); return }
        waiting.add(then)
        if (tts != null) return
        tts = TextToSpeech(activity) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) {
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String?) {}
                    override fun onDone(id: String?) { main.post { call("bernudSpoke", "") } }
                    @Deprecated("Deprecated in Java") override fun onError(id: String?) { main.post { call("bernudSpoke", "") } }
                    override fun onStop(id: String?, interrupted: Boolean) { main.post { call("bernudSpoke", "") } }
                })
                applyVoice()
            }
            main.post { val w = waiting.toList(); waiting.clear(); w.forEach { it() } }
        }
    }

    // The voice, pitch and speed chosen in Bernard's settings (UK English by default).
    private fun applyVoice() {
        val t = tts ?: return
        t.language = Locale.UK
        val name = prefs.getString("ttsVoice", null)
        if (name != null) try { t.voices?.firstOrNull { it.name == name }?.let { t.voice = it } } catch (_: Exception) {}
        t.setPitch(prefs.getFloat("ttsPitch", 1f))
        t.setSpeechRate(prefs.getFloat("ttsRate", 1f))
    }

    fun speak(text: String) = main.post {
        withTts { if (ttsReady) say(text) else call("bernudSpoke", "") }
    }

    // Lists the phone's English voices for the settings picker (sent back to window.bernudVoices).
    fun listVoices() = main.post {
        withTts {
            val out = JSONObject()
            val arr = JSONArray()
            try {
                (tts?.voices ?: emptySet()).filter { it.locale.language == "en" }
                    .sortedWith(compareBy({ it.locale.country != "GB" }, { it.isNetworkConnectionRequired }, { it.name }))
                    .forEach { v ->
                        arr.put(JSONObject().put("name", v.name).put("locale", v.locale.toLanguageTag())
                            .put("network", v.isNetworkConnectionRequired)
                            .put("installed", !v.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)))
                    }
            } catch (_: Exception) {}
            out.put("voices", arr).put("current", tts?.voice?.name ?: "")
                .put("pitch", prefs.getFloat("ttsPitch", 1f).toDouble()).put("rate", prefs.getFloat("ttsRate", 1f).toDouble())
                .put("engine", tts?.defaultEngine ?: "")
            js("window.bernudVoices && window.bernudVoices(${out})")
        }
    }

    fun setVoice(name: String, pitch: Float, rate: Float) = main.post {
        prefs.edit().apply { if (name.isNotBlank()) putString("ttsVoice", name) else remove("ttsVoice") }
            .putFloat("ttsPitch", pitch.coerceIn(0.5f, 2f)).putFloat("ttsRate", rate.coerceIn(0.5f, 2f)).apply()
        withTts { applyVoice() }
    }

    // Bernard's speaking volume (0..1), set from the dashboard slider and kept between runs.
    fun setVolume(v: Float) { prefs.edit().putFloat("ttsVolume", v.coerceIn(0f, 1f)).apply() }

    private fun say(text: String) {
        val params = Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, prefs.getFloat("ttsVolume", 1f)) }
        val r = tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, "bernud-" + System.currentTimeMillis())
        if (r != TextToSpeech.SUCCESS) call("bernudSpoke", "")
    }

    fun stopSpeaking() = main.post { try { tts?.stop() } catch (_: Exception) {} }

    fun destroy() { release(); try { tts?.shutdown() } catch (_: Exception) {}; tts = null }
}
