package ru.reu256.cabinet

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.annotation.StringRes
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Вход только через Telegram: приложение создаёт запрос, открывает бота по ссылке
 * t.me/<бот>?start=app_<код> и ждёт, пока человек нажмёт «Подтвердить вход в приложение».
 */
class LoginActivity : AppCompatActivity() {
    private lateinit var store: SessionStore
    private lateinit var btnLogin: Button
    private lateinit var waitBox: View
    private lateinit var tvStatus: TextView
    private lateinit var tvError: TextView
    private var pollJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SessionStore(applicationContext)
        if (store.token != null) return goMain()

        setContentView(R.layout.activity_login)
        findViewById<View>(R.id.loginRoot).applySystemBarsPadding()
        btnLogin = findViewById(R.id.btnLogin)
        waitBox = findViewById(R.id.waitBox)
        tvStatus = findViewById(R.id.tvStatus)
        tvError = findViewById(R.id.tvError)

        btnLogin.setOnClickListener { startLogin() }
        findViewById<Button>(R.id.btnReopen).setOnClickListener {
            store.pendingCode?.let { openTelegram(Config.botLink("app_$it")) }
        }
        findViewById<Button>(R.id.btnCancel).setOnClickListener { stopWaiting(null) }

        // приложение закрыли, пока шло ожидание: продолжаем с того же запроса
        if (store.hasValidPending()) startWaiting() else store.clearPending()
    }

    private fun startLogin() {
        if (!Config.isConfigured) return showError(R.string.err_not_configured)
        showError(null)
        btnLogin.isEnabled = false
        lifecycleScope.launch {
            try {
                val secret = AuthApi.randomHex(32)
                val init = withContext(Dispatchers.IO) { AuthApi.init(AuthApi.sha256Hex(secret)) }
                store.savePending(init.code, secret, System.currentTimeMillis() + init.ttl * 1000L)
                startWaiting()
                openTelegram(init.link)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                btnLogin.isEnabled = true
                showError(R.string.err_network)
                // техническая причина (например, HTTP 404 — на сайте ещё нет функции входа)
                tvError.text = getString(R.string.err_network) + "\n(" + (e.message ?: e.javaClass.simpleName) + ")"
            }
        }
    }

    private fun startWaiting() {
        btnLogin.visibility = View.GONE
        waitBox.visibility = View.VISIBLE
        tvStatus.setText(R.string.status_waiting)
        pollJob?.cancel()
        pollJob = lifecycleScope.launch {
            // пока человек в Telegram, экран остановлен: опрос ставится на паузу и продолжается при возврате
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (isActive) {
                    val code = store.pendingCode
                    val secret = store.pendingSecret
                    if (code == null || secret == null || System.currentTimeMillis() > store.pendingExp) {
                        return@repeatOnLifecycle stopWaiting(R.string.err_expired)
                    }
                    try {
                        when (val r = withContext(Dispatchers.IO) { AuthApi.poll(code, secret) }) {
                            is AuthApi.Poll.Ok -> {
                                store.saveToken(r.token, r.name)
                                store.clearPending()
                                return@repeatOnLifecycle goMain()
                            }
                            is AuthApi.Poll.Denied -> return@repeatOnLifecycle stopWaiting(
                                if (r.reason == "not_member") R.string.err_not_member else R.string.err_cancelled
                            )
                            AuthApi.Poll.Expired -> return@repeatOnLifecycle stopWaiting(R.string.err_expired)
                            AuthApi.Poll.Opened -> tvStatus.setText(R.string.status_opened)
                            AuthApi.Poll.Pending -> tvStatus.setText(R.string.status_waiting)
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        tvStatus.setText(R.string.status_offline)
                    }
                    delay(2000)
                }
            }
        }
    }

    private fun stopWaiting(@StringRes error: Int?) {
        pollJob?.cancel()
        store.clearPending()
        waitBox.visibility = View.GONE
        btnLogin.visibility = View.VISIBLE
        btnLogin.isEnabled = true
        showError(error)
    }

    private fun showError(@StringRes res: Int?) {
        if (res == null) {
            tvError.visibility = View.GONE
        } else {
            tvError.setText(res)
            tvError.visibility = View.VISIBLE
        }
    }

    private fun openTelegram(link: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.err_no_telegram, Toast.LENGTH_LONG).show()
        }
    }

    private fun goMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
