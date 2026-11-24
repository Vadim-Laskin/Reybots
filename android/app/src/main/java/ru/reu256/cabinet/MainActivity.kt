package ru.reu256.cabinet

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.google.android.material.appbar.MaterialToolbar
import org.json.JSONObject

/**
 * Каркас: открывает страницы сайта в WebView и добавляет то, чего нет на сайте —
 * нижнюю панель (Кабинет / Расписание / Бот), «Обновить» и «Выйти».
 */
class MainActivity : AppCompatActivity() {
    private lateinit var store: SessionStore
    private lateinit var webView: WebView
    private lateinit var progress: LinearProgressIndicator
    private lateinit var errorBox: View
    private lateinit var bottomNav: BottomNavigationView
    private lateinit var toolbar: MaterialToolbar

    @Volatile private var pageTrusted = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null

    private val fileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data))
        fileCallback = null
    }
    private val micLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val req = pendingPermission
        pendingPermission = null
        if (req != null) {
            if (granted) req.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else req.deny()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SessionStore(applicationContext)
        if (store.token == null || !Config.isConfigured) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }
        setContentView(R.layout.activity_main)
        findViewById<View>(R.id.mainRoot).applySystemBarsPadding()
        toolbar = findViewById(R.id.toolbar)
        progress = findViewById(R.id.progress)
        errorBox = findViewById(R.id.errorBox)
        bottomNav = findViewById(R.id.bottomNav)
        webView = findViewById(R.id.webView)

        setSupportActionBar(toolbar)
        setupWebView()
        setupNav()
        findViewById<View>(R.id.btnRetry).setOnClickListener {
            errorBox.visibility = View.GONE
            webView.reload()
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = goBack()
        })

        webView.loadUrl(Config.url("/cabinet/"))
    }

    /* ---------- WebView ---------- */

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.setBackgroundColor(Color.TRANSPARENT)
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString ReyApp/1.0"
        }
        setupBridge()
        webView.setDownloadListener { url, _, _, _, _ ->
            if (url.startsWith("http")) openExternal(Uri.parse(url))
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && uri.host == Config.HOST) return false
                openExternal(uri) // всё чужое (t.me, почта, другие сайты) открываем снаружи
                return true
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                pageTrusted = Uri.parse(url).host == Config.HOST
                progress.visibility = View.VISIBLE
                errorBox.visibility = View.GONE
            }

            override fun onPageFinished(view: WebView, url: String) {
                progress.visibility = View.GONE
                syncNav(url)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    errorBox.visibility = View.VISIBLE
                    progress.visibility = View.GONE
                }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.setProgressCompat(newProgress, true)
            }

            // выбор файлов (вложения домашки, материалы)
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    fileLauncher.launch(params.createIntent())
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }

            // микрофон для голосового помощника, только для своего сайта
            override fun onPermissionRequest(request: PermissionRequest) {
                val ok = request.origin.host == Config.HOST &&
                    request.resources.all { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                if (!ok) return request.deny()
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED
                ) {
                    request.grant(request.resources)
                } else {
                    pendingPermission?.deny()
                    pendingPermission = request
                    micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            }
        }
    }

    /**
     * Токен получает только страница нашего сайта: скрипт добавляется строго для этого источника.
     * Если WebView старый и так нельзя, работает запасной мост (страница проверяется по адресу).
     */
    private fun setupBridge() {
        val token = store.token ?: ""
        val supported = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (supported) {
            val origin = setOf(Config.ORIGIN)
            WebViewCompat.addWebMessageListener(webView, "ReyBridge", origin) { _, message, _, _, _ ->
                if (message.data == "logout") runOnUiThread { logout() }
            }
            val script = "window.ReyApp={isApp:true,session:function(){return ${JSONObject.quote(token)};}," +
                "logout:function(){try{ReyBridge.postMessage('logout');}catch(e){}}};"
            WebViewCompat.addDocumentStartJavaScript(webView, script, origin)
        } else {
            webView.addJavascriptInterface(LegacyBridge(), "ReyApp")
        }
    }

    inner class LegacyBridge {
        @JavascriptInterface
        fun session(): String = if (pageTrusted) store.token ?: "" else ""

        @JavascriptInterface
        fun logout() {
            if (pageTrusted) runOnUiThread { logout() }
        }
    }

    /* ---------- кнопки, которых нет на сайте ---------- */

    private fun setupNav() {
        bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_cabinet -> { webView.loadUrl(Config.url("/cabinet/")); true }
                R.id.nav_schedule -> { webView.loadUrl(Config.url("/")); true }
                R.id.nav_bot -> { openExternal(Uri.parse(Config.botLink())); false }
                else -> false
            }
        }
        bottomNav.setOnItemReselectedListener { item ->
            when (item.itemId) {
                R.id.nav_cabinet -> webView.loadUrl(Config.url("/cabinet/"))
                R.id.nav_schedule -> webView.loadUrl(Config.url("/"))
            }
        }
    }

    private fun syncNav(url: String) {
        val path = Uri.parse(url).path.orEmpty()
        val id = if (path.startsWith("/cabinet")) R.id.nav_cabinet else R.id.nav_schedule
        bottomNav.menu.findItem(id)?.isChecked = true
        supportActionBar?.title = getString(if (id == R.id.nav_cabinet) R.string.nav_cabinet else R.string.nav_schedule)
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        R.id.action_refresh -> { webView.reload(); true }
        R.id.action_logout -> {
            AlertDialog.Builder(this)
                .setTitle(R.string.logout_title)
                .setMessage(R.string.logout_message)
                .setPositiveButton(R.string.logout_yes) { _, _ -> logout() }
                .setNegativeButton(R.string.cancel, null)
                .show()
            true
        }
        else -> super.onOptionsItemSelected(item)
    }

    private fun logout() {
        store.clearAll()
        webView.clearHistory()
        WebStorage.getInstance().deleteAllData()
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    /** «Назад»: сначала закрываем вложенный экран или окно на странице, потом идём по истории, потом выходим. */
    private fun goBack() {
        val js = "(function(){try{var h=function(i){var e=document.getElementById(i);return e&&!e.hidden;};" +
            "var s=document.querySelector('.screen:not([hidden])');" +
            "if(typeof back==='function'&&((s&&s.id!=='home')||h('vchat')||h('aichat')||h('imgv')||h('modal'))){back();return 'in';}" +
            "}catch(e){}return 'out';})()"
        webView.evaluateJavascript(js) { r ->
            if (r == "\"in\"") return@evaluateJavascript
            if (webView.canGoBack()) webView.goBack() else finish()
        }
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            // нечем открыть — ничего не делаем
        }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            fileCallback?.onReceiveValue(null)
            webView.destroy()
        }
        super.onDestroy()
    }
}
