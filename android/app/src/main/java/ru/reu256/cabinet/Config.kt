package ru.reu256.cabinet

import android.net.Uri

object Config {
    /** Адрес сайта (из gradle.properties, reyBaseUrl). */
    val BASE_URL: String = BuildConfig.BASE_URL.trimEnd('/')

    /** Бот, через которого идёт вход. Должен совпадать с BOT_USERNAME на сервере. */
    const val BOT_USERNAME = "Armaturchic_bot"

    private val uri: Uri = Uri.parse(BASE_URL)
    val HOST: String = uri.host ?: ""

    /** Источник (схема + хост + порт) — им ограничивается доступ страницы к токену. */
    val ORIGIN: String = if (HOST.isEmpty()) "" else buildString {
        append(uri.scheme ?: "https").append("://").append(HOST)
        if (uri.port != -1) append(':').append(uri.port)
    }

    val isConfigured: Boolean
        get() = HOST.isNotEmpty() && !BASE_URL.contains("YOUR-SITE", ignoreCase = true) && uri.scheme == "https"

    fun url(path: String) = BASE_URL + path

    fun botLink(startParam: String? = null): String =
        "https://t.me/$BOT_USERNAME" + (startParam?.let { "?start=$it" } ?: "")
}
