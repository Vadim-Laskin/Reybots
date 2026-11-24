package ru.reu256.cabinet

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Свой кэш сайта. Все GET-запросы страницы к нашему сайту идут через него:
 * есть связь — берём с сервера и сохраняем в файлы, нет связи (например, без VPN) — отдаём сохранённую копию.
 * Так кабинет и расписание открываются без интернета, а не зависят от кэша WebView.
 */
class SiteProxy(context: Context, private val listener: Listener) {
    interface Listener {
        /** Сервер перестал отвечать (вызывается один раз за сбой). */
        fun onServerDown()

        /** Сервер снова отвечает. */
        fun onServerRecovered()
    }

    private val dir = File(context.applicationContext.filesDir, "site-cache").apply { mkdirs() }

    @Volatile var isDown = false
        private set
    private var saves = 0

    /** Пока сервер недоступен, лишний раз его не ждём: сразу отдаём сохранённое. */
    fun forceNetwork() {
        isDown = false
    }

    /** Проверка, отвечает ли сервер (маленький файл). Вызывать не из главного потока. */
    fun probe() {
        try {
            val c = open(Config.url("/app-offline.js"), null)
            val code = c.responseCode
            c.disconnect()
            if (code < 500) ok()
        } catch (e: IOException) {
            // всё ещё нет связи
        }
    }

    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }

    /** Ответ для WebView или null, если запрос не наш и его нужно выполнить как обычно. */
    fun handle(request: WebResourceRequest): WebResourceResponse? {
        val uri: Uri = request.url
        if (request.method != "GET" || uri.scheme != "https" || uri.host != Config.HOST) return null
        if (request.requestHeaders.keys.any { it.equals("Range", ignoreCase = true) }) return null
        val key = uri.toString()

        if (!isDown) {
            try {
                val c = open(key, request.requestHeaders)
                val code = c.responseCode
                if (code in 200..299) {
                    if (c.contentLengthLong > MAX_BYTES) {
                        c.disconnect()
                        return null
                    }
                    val type = c.contentType ?: "application/octet-stream"
                    val bytes = c.inputStream.use { it.readBytes() }
                    c.disconnect()
                    ok()
                    save(key, type, bytes)
                    return response(type, bytes)
                }
                c.disconnect()
                if (code < 500) {
                    ok() // сервер отвечает (например, 404): пусть WebView покажет ответ сам
                    return null
                }
                // 5xx: сервер болен, ниже отдадим сохранённое, если оно есть
            } catch (e: IOException) {
                failed()
            }
        }
        val saved = load(key) ?: return null
        return response(saved.first, saved.second)
    }

    /* ---------- состояние ---------- */

    private fun ok() {
        if (isDown) {
            isDown = false
            listener.onServerRecovered()
        }
    }

    private fun failed() {
        if (!isDown) {
            isDown = true
            listener.onServerDown()
        }
    }

    /* ---------- сеть ---------- */

    private fun open(url: String, headers: Map<String, String>?): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 6_000
        c.readTimeout = 15_000
        headers?.forEach { (k, v) ->
            if (k.equals("User-Agent", true) || k.equals("Accept", true) || k.equals("Accept-Language", true)) {
                c.setRequestProperty(k, v)
            }
        }
        return c
    }

    private fun response(contentType: String, bytes: ByteArray): WebResourceResponse {
        val mime = contentType.substringBefore(';').trim().ifEmpty { "application/octet-stream" }
        val charset = Regex("charset=([\\w-]+)", RegexOption.IGNORE_CASE).find(contentType)?.groupValues?.get(1)
        val enc = charset ?: if (mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json")) "utf-8" else null
        return WebResourceResponse(mime, enc, 200, "OK", mapOf("Cache-Control" to "no-cache"), ByteArrayInputStream(bytes))
    }

    /* ---------- файлы ---------- */

    private fun name(url: String) =
        MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun save(url: String, type: String, bytes: ByteArray) {
        try {
            val n = name(url)
            val tmp = File(dir, "$n.tmp")
            tmp.writeBytes(bytes)
            File(dir, "$n.type").writeText(type)
            tmp.renameTo(File(dir, "$n.bin"))
            if (++saves % 25 == 0) trim()
        } catch (e: Exception) {
            // нет места или файл занят: просто не сохраняем
        }
    }

    private fun load(url: String): Pair<String, ByteArray>? {
        return try {
            val n = name(url)
            val bin = File(dir, "$n.bin")
            if (!bin.exists()) return null
            val type = File(dir, "$n.type").takeIf { it.exists() }?.readText() ?: "application/octet-stream"
            type to bin.readBytes()
        } catch (e: Exception) {
            null
        }
    }

    /** Не даём кэшу расти бесконечно: старые файлы удаляем. */
    private fun trim() {
        val files = dir.listFiles { f -> f.name.endsWith(".bin") }?.sortedBy { it.lastModified() } ?: return
        var total = files.sumOf { it.length() }
        for (f in files) {
            if (total <= KEEP_BYTES) break
            total -= f.length()
            f.delete()
            File(dir, f.name.removeSuffix(".bin") + ".type").delete()
        }
    }

    private companion object {
        const val MAX_BYTES = 10L * 1024 * 1024
        const val KEEP_BYTES = 60L * 1024 * 1024
    }
}
