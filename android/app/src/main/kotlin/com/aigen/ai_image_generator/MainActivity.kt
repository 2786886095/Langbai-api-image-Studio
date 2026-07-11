package com.aigen.ai_image_generator

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import androidx.documentfile.provider.DocumentFile
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val channelName = "com.aigen.ai_image_generator/downloads"
    private val prefsName = "download_dirs"
    private val requestChooseDir = 4101
    private val requestChooseFiles = 4102

    private var pendingKind: String? = null
    private var pendingResult: MethodChannel.Result? = null
    private var pendingFileResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "chooseDirectory" -> {
                        val kind = call.argument<String>("kind") ?: "images"
                        chooseDirectory(kind, result)
                    }
                    "getSavedDirectories" -> result.success(getSavedDirectories())
                    "chooseFiles" -> {
                        val acceptTypes = call.argument<List<String>>("acceptTypes") ?: listOf("*/*")
                        val allowMultiple = call.argument<Boolean>("allowMultiple") ?: false
                        chooseFiles(acceptTypes, allowMultiple, result)
                    }
                    "saveFile" -> {
                        val kind = call.argument<String>("kind") ?: "images"
                        val fileName = call.argument<String>("fileName") ?: "download.bin"
                        val mimeType = call.argument<String>("mimeType") ?: "application/octet-stream"
                        val base64 = call.argument<String>("base64") ?: ""
                        val folder = call.argument<String>("folder") ?: ""
                        saveFile(kind, fileName, mimeType, base64, folder, result)
                    }
                    "openExternalUrl" -> {
                        val url = call.argument<String>("url") ?: ""
                        openExternalUrl(url, result)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun chooseFiles(
        acceptTypes: List<String>,
        allowMultiple: Boolean,
        result: MethodChannel.Result
    ) {
        if (pendingFileResult != null) {
            result.error("busy", "A file picker is already open.", null)
            return
        }

        pendingFileResult = result
        val normalizedTypes = acceptTypes
            .map { it.trim() }
            .filter { it.isNotBlank() && it != "." }
            .map {
                when (it.lowercase()) {
                    ".txt" -> "text/plain"
                    ".png" -> "image/png"
                    ".jpg", ".jpeg" -> "image/jpeg"
                    ".webp" -> "image/webp"
                    ".gif" -> "image/gif"
                    else -> it
                }
            }
            .distinct()
            .ifEmpty { listOf("*/*") }

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (normalizedTypes.size == 1) normalizedTypes.first() else "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
            if (normalizedTypes.size > 1) {
                putExtra(Intent.EXTRA_MIME_TYPES, normalizedTypes.toTypedArray())
            }
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            )
        }
        try {
            startActivityForResult(intent, requestChooseFiles)
        } catch (e: Exception) {
            pendingFileResult = null
            result.error("picker_unavailable", e.message ?: "File picker is unavailable.", null)
        }
    }

    private fun chooseDirectory(kind: String, result: MethodChannel.Result) {
        if (pendingResult != null) {
            result.error("busy", "A directory picker is already open.", null)
            return
        }

        pendingKind = kind
        pendingResult = result
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            )
        }
        try {
            startActivityForResult(intent, requestChooseDir)
        } catch (e: Exception) {
            pendingResult = null
            pendingKind = null
            result.error("picker_unavailable", e.message ?: "Directory picker is unavailable.", null)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == requestChooseFiles) {
            handleFilesResult(resultCode, data)
            return
        }
        if (requestCode != requestChooseDir) return

        val result = pendingResult
        val kind = pendingKind ?: "images"
        pendingResult = null
        pendingKind = null

        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            result?.error("cancelled", "Directory selection cancelled.", null)
            return
        }

        val uri = data.data!!
        val flags = data.flags and (
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
        try {
            if (flags != 0) contentResolver.takePersistableUriPermission(uri, flags)
        } catch (_: Exception) {
            // Some document providers return a usable tree URI without persistable grants.
        }
        prefs().edit().putString(kind, uri.toString()).apply()
        result?.success(uri.toString())
    }

    private fun handleFilesResult(resultCode: Int, data: Intent?) {
        val result = pendingFileResult
        pendingFileResult = null

        if (resultCode != Activity.RESULT_OK || data == null) {
            result?.success(emptyList<String>())
            return
        }

        val uris = mutableListOf<String>()
        val flags = data.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION
        data.clipData?.let { clip ->
            for (i in 0 until clip.itemCount) {
                val uri = clip.getItemAt(i).uri
                persistReadPermission(uri, flags)
                uris.add(uri.toString())
            }
        }
        data.data?.let { uri ->
            persistReadPermission(uri, flags)
            if (!uris.contains(uri.toString())) uris.add(uri.toString())
        }
        result?.success(uris)
    }

    private fun persistReadPermission(uri: Uri, flags: Int) {
        try {
            if (flags != 0) contentResolver.takePersistableUriPermission(uri, flags)
        } catch (_: Exception) {
            // Some providers do not support persistable permissions.
        }
    }

    private fun saveFile(
        kind: String,
        fileName: String,
        mimeType: String,
        encoded: String,
        folder: String,
        result: MethodChannel.Result
    ) {
        try {
            val dirUri = prefs().getString(kind, null)
            if (dirUri.isNullOrBlank()) {
                result.error("missing_directory", "No $kind download directory selected.", null)
                return
            }

            val tree = DocumentFile.fromTreeUri(this, Uri.parse(dirUri))
            if (tree == null || !tree.canWrite()) {
                result.error("directory_unavailable", "Selected $kind directory is not writable.", null)
                return
            }

            var targetDir: DocumentFile = tree
            val trimmedFolder = folder.trim()
            if (trimmedFolder.isNotEmpty()) {
                val safeFolder = sanitizeFileName(trimmedFolder)
                if (safeFolder.isNotEmpty() && safeFolder != "." && safeFolder != "..") {
                    val existing = tree.findFile(safeFolder)
                    val folderDir = if (existing != null && existing.isDirectory) existing else tree.createDirectory(safeFolder)
                    if (folderDir == null) {
                        result.error("create_failed", "Cannot create folder $safeFolder.", null)
                        return
                    }
                    targetDir = folderDir
                }
            }

            val safeName = sanitizeFileName(fileName)
            targetDir.findFile(safeName)?.delete()
            val file = targetDir.createFile(mimeType, safeName)
            if (file == null) {
                result.error("create_failed", "Cannot create $safeName.", null)
                return
            }

            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            contentResolver.openOutputStream(file.uri, "w").use { stream ->
                if (stream == null) {
                    result.error("open_failed", "Cannot open output stream.", null)
                    return
                }
                stream.write(bytes)
            }
            result.success(file.uri.toString())
        } catch (e: Exception) {
            result.error("save_failed", e.message, null)
        }
    }

    private fun getSavedDirectories(): Map<String, String> {
        val prefs = prefs()
        return mapOf(
            "images" to (prefs.getString("images", "") ?: ""),
            "zips" to (prefs.getString("zips", "") ?: "")
        )
    }

    private fun openExternalUrl(url: String, result: MethodChannel.Result) {
        try {
            val uri = Uri.parse(url)
            if (uri.scheme != "http" && uri.scheme != "https") {
                result.error("invalid_url", "Only http/https URLs can be opened.", null)
                return
            }
            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
            }
            startActivity(intent)
            result.success(true)
        } catch (e: Exception) {
            result.error("open_failed", e.message, null)
        }
    }

    private fun prefs() = getSharedPreferences(prefsName, MODE_PRIVATE)

    private fun sanitizeFileName(name: String): String {
        val fallback = "download-${System.currentTimeMillis()}.bin"
        return (name.ifBlank { fallback })
            .replace(Regex("""[\\/:*?"<>|]"""), "_")
            .take(180)
    }
}
