package ru.reu256.cabinet

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom

/** Запросы к серверу входа (/.netlify/functions/appauth). Вызывать не из главного потока. */
object AuthApi {
    class Init(val code: String, val link: String, val ttl: Int)

    sealed class Poll {
        data object Pending : Poll()
        data object Opened : Poll()
        data object Expired : Poll()
        class Denied(val reason: String) : Poll()
        class Ok(val token: String, val name: String) : Poll()
    }

    fun init(secretHash: String): Init {
        val j = post(JSONObject().put("action", "init").put("h", secretHash))
        return Init(j.getString("code"), j.getString("link"), j.optInt("ttl", 300))
    }

    fun poll(code: String, secret: String): Poll {
        val j = post(JSONObject().put("action", "poll").put("code", code).put("secret", secret))
        return when (j.optString("status")) {
            "ok" -> Poll.Ok(j.getString("token"), j.optJSONObject("user")?.optString("name").orEmpty())
            "denied" -> Poll.Denied(j.optString("reason", "cancel"))
            "expired" -> Poll.Expired
            "opened" -> Poll.Opened
            else -> Poll.Pending
        }
    }

    private fun post(body: JSONObject): JSONObject {
        val c = URL(Config.url("/.netlify/functions/appauth")).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 10_000
            c.readTimeout = 15_000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            val text = (if (code < 400) c.inputStream else c.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (code >= 400) throw IOException("HTTP $code")
            return JSONObject(text)
        } finally {
            c.disconnect()
        }
    }

    fun randomHex(bytes: Int): String {
        val b = ByteArray(bytes).also { SecureRandom().nextBytes(it) }
        return b.joinToString("") { "%02x".format(it) }
    }

    fun sha256Hex(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
