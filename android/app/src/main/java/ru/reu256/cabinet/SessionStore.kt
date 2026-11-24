package ru.reu256.cabinet

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Сессия и ожидающий вход хранятся в зашифрованных настройках. */
class SessionStore(context: Context) {
    private val prefs: SharedPreferences = open(context.applicationContext)

    val token: String?
        get() = prefs.getString(K_TOKEN, null)?.takeIf { it.isNotEmpty() }

    val userName: String get() = prefs.getString(K_NAME, "") ?: ""

    fun saveToken(token: String, name: String) = prefs.edit {
        putString(K_TOKEN, token)
        putString(K_NAME, name)
    }

    /* Запрос на вход, который ждёт подтверждения в Telegram */
    val pendingCode: String? get() = prefs.getString(K_CODE, null)
    val pendingSecret: String? get() = prefs.getString(K_SECRET, null)
    val pendingExp: Long get() = prefs.getLong(K_EXP, 0L)

    fun hasValidPending() = pendingCode != null && pendingSecret != null && System.currentTimeMillis() < pendingExp

    fun savePending(code: String, secret: String, exp: Long) = prefs.edit {
        putString(K_CODE, code)
        putString(K_SECRET, secret)
        putLong(K_EXP, exp)
    }

    fun clearPending() = prefs.edit {
        remove(K_CODE)
        remove(K_SECRET)
        remove(K_EXP)
    }

    fun clearAll() = prefs.edit { clear() }

    private companion object {
        const val FILE = "rey_session"
        const val K_TOKEN = "token"
        const val K_NAME = "name"
        const val K_CODE = "p_code"
        const val K_SECRET = "p_secret"
        const val K_EXP = "p_exp"

        fun open(ctx: Context): SharedPreferences {
            fun create() = EncryptedSharedPreferences.create(
                ctx,
                FILE,
                MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
            return try {
                create()
            } catch (e: Exception) {
                // ключ в хранилище мог испортиться (например, после восстановления данных): начинаем с чистого листа
                ctx.deleteSharedPreferences(FILE)
                create()
            }
        }
    }
}
