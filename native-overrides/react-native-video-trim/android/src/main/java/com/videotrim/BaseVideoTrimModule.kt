package com.videotrim

import android.R.attr.progressBarStyleHorizontal
import android.R.attr.selectableItemBackground
import android.R.color.holo_red_light
import android.R.style.Theme_Black_NoTitleBar_Fullscreen
import android.app.Activity
import android.content.Context
import android.content.DialogInterface
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.text.TextPaint
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.graphics.toColorInt
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.ReturnCode
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.videotrim.enums.ErrorCode
import com.videotrim.interfaces.VideoTrimListener
import com.videotrim.utils.MediaMetadataUtil
import com.videotrim.utils.StorageUtil
import com.videotrim.utils.VideoTrimmerUtil
import com.videotrim.widgets.VideoTrimmerView
import iknow.android.utils.BaseUtils
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.TimeZone
import kotlin.math.min

/**
 * Contains all shared business logic between old + new arch.
 * Does NOT know how to emit events.
 */
open class BaseVideoTrimModule internal constructor(
  private val reactApplicationContext: ReactApplicationContext,
  private val sendEvent: (eventName: String, params: WritableMap?) -> Unit
) : VideoTrimListener, LifecycleEventListener {

  private var trimmerView: VideoTrimmerView? = null
  private var alertDialog: AlertDialog? = null
  private var mProgressDialog: AlertDialog? = null
  private var cancelTrimmingConfirmDialog: AlertDialog? = null
  private var mProgressBar: ProgressBar? = null
  private var outputFile: String? = null
  private var isVideoType = true
  private var editorConfig: ReadableMap? = null
  private var originalStatusBarColor: Int = Color.TRANSPARENT
  private val shouldChangeStatusBarColorOnOpen: Boolean
    get() = editorConfig?.hasKey("changeStatusBarColorOnOpen") == true && editorConfig?.getBoolean("changeStatusBarColorOnOpen") == true
  private var pendingSaveToDocumentsPromise: Promise? = null
  private var pendingSaveToDocumentsFile: File? = null

  init {
    // Initialize BaseUtils eagerly so DeviceUtil / VideoTrimmerUtil static
    // fields resolve correctly even when a headless API (compress, toGif,
    // merge, …) is called before showEditor has ever been opened.
    BaseUtils.init(reactApplicationContext)
    reactApplicationContext.addLifecycleEventListener(this)

    val mActivityEventListener = object : BaseActivityEventListener() {
      override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        intent: Intent?
      ) {
        if (requestCode == REQUEST_CODE_SAVE_FILE && resultCode == Activity.RESULT_OK) {

          val uri = intent?.data ?: return
          try {
            reactApplicationContext.contentResolver?.openOutputStream(uri)
              ?.use { outputStream ->
                FileInputStream(outputFile).use { fileInputStream ->
                  val buffer = ByteArray(1024)
                  var length: Int
                  while (fileInputStream.read(buffer).also { length = it } > 0) {
                    outputStream.write(buffer, 0, length)
                  }
                }
              } ?: return
            // File saved successfully
            Log.d(TAG, "File saved successfully to $uri")

            if (
              editorConfig?.getBoolean("removeAfterSavedToDocuments") == true
            ) {
              StorageUtil.deleteFile(outputFile)
            }

          } catch (e: Exception) {
            e.printStackTrace()
            // Handle the error
            onError(
              "Failed to save edited video to Documents: ${e.localizedMessage}",
              ErrorCode.FAIL_TO_SAVE_TO_DOCUMENTS
            )
            if (editorConfig?.getBoolean("removeAfterFailedToSaveDocuments") == true) {
              StorageUtil.deleteFile(outputFile)
            }
          } finally {
            hideDialog(true)
          }
        }

        if (requestCode == REQUEST_CODE_SAVE_TO_DOCUMENTS) {
          val promise = pendingSaveToDocumentsPromise
          val sourceFile = pendingSaveToDocumentsFile
          pendingSaveToDocumentsPromise = null
          pendingSaveToDocumentsFile = null

          if (promise == null || sourceFile == null) return

          if (resultCode == Activity.RESULT_OK) {
            val uri = intent?.data
            if (uri == null) {
              promise.reject(Exception("No destination selected"))
              return
            }
            try {
              reactApplicationContext.contentResolver?.openOutputStream(uri)
                ?.use { outputStream ->
                  FileInputStream(sourceFile).use { inputStream ->
                    val buffer = ByteArray(1024)
                    var length: Int
                    while (inputStream.read(buffer).also { length = it } > 0) {
                      outputStream.write(buffer, 0, length)
                    }
                  }
                }
              val result = Arguments.createMap()
              result.putBoolean("success", true)
              promise.resolve(result)
            } catch (e: Exception) {
              promise.reject(Exception("Failed to save to documents: ${e.message}"))
            }
          } else {
            val result = Arguments.createMap()
            result.putBoolean("success", false)
            promise.resolve(result)
          }
        }
      }
    }
    reactApplicationContext.addActivityEventListener(mActivityEventListener)
  }


  fun showEditor(
    filePath: String,
    config: ReadableMap,
  ) {
    if (trimmerView != null || alertDialog != null) {
      return
    }

    this.editorConfig = config

    this.isVideoType = config.hasKey("type") && config.getString("type") == "video"

    val activity = reactApplicationContext.currentActivity ?: run {
      onError("Activity is not available", ErrorCode.UNKNOWN)
      return
    }
    // here is NOT main thread, we need to create VideoTrimmerView on UI thread, so that later we can update it using same thread
    UiThreadUtil.runOnUiThread {
      trimmerView = VideoTrimmerView(reactApplicationContext, editorConfig, null)
      trimmerView?.setOnTrimVideoListener(this)
      trimmerView?.initByURI(filePath.toUri())

      val builder = AlertDialog.Builder(
        activity, Theme_Black_NoTitleBar_Fullscreen
      )
      builder.setCancelable(false)
      alertDialog = builder.create()
      alertDialog?.setView(trimmerView)

      // Apply safe area handling after the dialog is shown
      alertDialog?.setOnShowListener {
        val dialog = alertDialog ?: return@setOnShowListener
        val view = trimmerView ?: return@setOnShowListener
        applySafeAreaToDialog(dialog, view)

        sendEvent("onShow", null)
      }

      // this is to ensure to release resource if dialog is dismissed in unexpected way (Eg. open control/notification center by dragging from top of screen)
      alertDialog?.setOnDismissListener {
        trimmerView?.onDestroy()
        trimmerView = null
        hideDialog(true)
        sendEvent("onHide", null)
      }

      alertDialog?.show()

      if (shouldChangeStatusBarColorOnOpen) {
        changeStatusBarColor()
      }
    }
  }

  private fun changeStatusBarColor() {
    val window = reactApplicationContext.currentActivity?.window
    window?.let {
      // Store the original color
      originalStatusBarColor = it.statusBarColor

      // 2. Clear flags and set the new color
      it.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);

      // add FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS flag to the window
      it.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

      // finally change the color
      it.statusBarColor = ContextCompat.getColor(reactApplicationContext, R.color.black)
    }
  }

  private fun restoreStatusBarColor() {
    val window = reactApplicationContext.currentActivity?.window
    window?.let {
      // 1. Restore the color to the previously stored value
      it.statusBarColor = originalStatusBarColor

      // 2. restore flags to their previous state
      //    For most cases, just setting the color is enough.
      it.addFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
      it.clearFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
    }
  }

  // because trimmerView is rendered within the dialog, we need to apply safe area insets to the dialog
  // else setOnApplyWindowInsetsListener will not fire
  private fun applySafeAreaToDialog(dialog: AlertDialog, trimmerView: VideoTrimmerView) {
    val window = dialog.window
    if (window != null) {
      // Enable edge-to-edge for the dialog window
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        window.setDecorFitsSystemWindows(false)
      }

      // Get the dialog's decorView and apply insets listener
      val decorView = window.decorView
      ViewCompat.setOnApplyWindowInsetsListener(decorView) { _, windowInsets ->
        val insets = windowInsets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
        Log.d(TAG, "Dialog insets: top=${insets.top}, left=${insets.left}, bottom=${insets.bottom}, right=${insets.right}")

        // Apply padding to the trimmer view
        trimmerView.setPadding(insets.left, insets.top, insets.right, insets.bottom)

        WindowInsetsCompat.CONSUMED
      }
      ViewCompat.requestApplyInsets(decorView)
    }
  }

  override fun onHostResume() {
    Log.d(TAG, "onHostResume: ")
  }

  override fun onHostPause() {
    Log.d(TAG, "onHostPause: ")
    trimmerView?.onMediaPause()
  }

  override fun onHostDestroy() {
    hideDialog(true)
  }

//  override fun invalidate() {
//    super.invalidate()
//    hideDialog(true)
//  }

  override fun onLoad(duration: Int) {
    val map = Arguments.createMap()
    map.putInt("duration", duration)
    sendEvent("onLoad", map)
  }

  override fun onTrimmingProgress(percentage: Int) {
    // prevent onTrimmingProgress is called after onFinishTrim (some rare cases)
    if (mProgressBar == null) {
      return
    }

    mProgressBar?.setProgress(percentage, true)
  }


  override fun onFinishTrim(out: String, startTime: Long, endTime: Long, duration: Int) {
    // save output file to use in other places
    outputFile = out

    val map = Arguments.createMap()
    map.putString("outputPath", outputFile)
    map.putInt("duration", duration)
    map.putDouble("startTime", startTime.toDouble())
    map.putDouble("endTime", endTime.toDouble())
    sendEvent("onFinishTrimming", map)

    if (editorConfig?.getBoolean("saveToPhoto") == true && isVideoType) {
      try {
        StorageUtil.saveToGallery(reactApplicationContext, outputFile)
        Log.d(TAG, "Edited video saved to Photo Library successfully.")
        if (editorConfig?.getBoolean("removeAfterSavedToPhoto") == true) {
          StorageUtil.deleteFile(outputFile)
        }
      } catch (e: IOException) {
        e.printStackTrace()
        onError(
          "Failed to save edited video to Photo Library: " + e.localizedMessage,
          ErrorCode.FAIL_TO_SAVE_TO_PHOTO
        )
        if (editorConfig?.getBoolean("removeAfterFailedToSavePhoto") == true) {
          StorageUtil.deleteFile(outputFile)
        }
      } finally {
        hideDialog(editorConfig?.getBoolean("closeWhenFinish") ?: true)
      }
    } else if (editorConfig?.getBoolean("openDocumentsOnFinish") == true) {
      val output = outputFile ?: return
      saveFileToExternalStorage(File(output))
    } else if (editorConfig?.getBoolean("openShareSheetOnFinish") == true) {
      hideDialog(editorConfig?.getBoolean("closeWhenFinish") ?: true)
      outputFile?.let { shareFile(reactApplicationContext, File(it)) }
    } else {
      hideDialog(editorConfig?.getBoolean("closeWhenFinish") ?: true)
    }
  }

  override fun onCancelTrim() {
    sendEvent("onCancelTrimming", null)
  }

  override fun onError(errorMessage: String?, errorCode: ErrorCode) {
    val map = Arguments.createMap()
    map.putString("message", errorMessage)
    map.putString("errorCode", errorCode.name)
    sendEvent("onError", map)
  }

  override fun onCancel() {
    if (editorConfig?.getBoolean("enableCancelDialog") != true) {
      sendEvent("onCancel", null)
      hideDialog(true)
      return
    }

    val activity = reactApplicationContext.currentActivity ?: return
    val builder = AlertDialog.Builder(activity)
    builder.setMessage(editorConfig?.getString("cancelDialogMessage"))
    builder.setTitle(editorConfig?.getString("cancelDialogTitle"))
    builder.setCancelable(false)
    builder.setPositiveButton(editorConfig?.getString("cancelDialogConfirmText")) { dialog: DialogInterface, _: Int ->
      dialog.cancel()
      sendEvent("onCancel", null)
      hideDialog(true)
    }
    builder.setNegativeButton(
      editorConfig?.getString("cancelDialogCancelText") ?: "Cancel"
    ) { dialog: DialogInterface, _: Int ->
      dialog.cancel()
    }
    val alertDialog = builder.create()
    alertDialog.show()
  }

  override fun onSave() {
    if (editorConfig?.getBoolean("enableSaveDialog") != true) {
      startTrim()
      return
    }

    val activity = reactApplicationContext.currentActivity ?: return
    val builder = AlertDialog.Builder(activity)
    builder.setMessage(editorConfig?.getString("saveDialogMessage"))
    builder.setTitle(editorConfig?.getString("saveDialogTitle"))
    builder.setCancelable(false)
    builder.setPositiveButton(editorConfig?.getString("saveDialogConfirmText")) { dialog: DialogInterface, _: Int ->
      dialog.cancel()
      startTrim()
    }
    builder.setNegativeButton(
      editorConfig?.getString("saveDialogCancelText") ?: "Cancel"
    ) { dialog: DialogInterface, _: Int ->
      dialog.cancel()
    }
    val alertDialog = builder.create()
    alertDialog.show()
  }

  override fun onLog(log: WritableMap) {
    sendEvent("onLog", log)
  }

  override fun onStatistics(statistics: WritableMap) {
    sendEvent("onStatistics", statistics)
  }

  private fun startTrim() {
    val activity = reactApplicationContext.currentActivity ?: return
    // Create the parent layout for the dialog
    val layout = LinearLayout(activity)
    layout.layoutParams = ViewGroup.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT,
      ViewGroup.LayoutParams.WRAP_CONTENT
    )
    layout.orientation = LinearLayout.VERTICAL
    layout.gravity = Gravity.CENTER_HORIZONTAL
    layout.setPadding(16, 32, 16, 32)

    // Create and add the TextView
    val textView = TextView(activity)
    textView.layoutParams = ViewGroup.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT,
      ViewGroup.LayoutParams.WRAP_CONTENT
    )
    textView.text = editorConfig?.getString("trimmingText")
      ?: "Trimming in progress..."
    textView.gravity = Gravity.CENTER
    textView.textSize = 18f
    layout.addView(textView)

    // Create and add the ProgressBar
    mProgressBar = ProgressBar(activity, null, progressBarStyleHorizontal).also {
      it.layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      )
      it.progressTintList = ColorStateList.valueOf("#2196F3".toColorInt())
    }
    layout.addView(mProgressBar)

    // Create button
    if (editorConfig?.getBoolean("enableCancelTrimming") == true) {
      val button = Button(activity)
      button.layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      )
      // Set the text and style it like a text button
      button.text = editorConfig?.getString("cancelTrimmingText")
        ?: "Cancel Trimming"
      button.setTextColor(
        ContextCompat.getColor(
          activity,
          holo_red_light
        )
      )

      // Apply ripple effect while keeping the button background transparent
      val outValue = TypedValue()
      activity.theme.resolveAttribute(selectableItemBackground, outValue, true)
      button.setBackgroundResource(outValue.resourceId)
      button.setOnClickListener { _: View? ->
        if (editorConfig?.getBoolean("enableCancelTrimmingDialog") == true) {
          val builder = AlertDialog.Builder(
            activity
          )
          builder.setMessage(editorConfig?.getString("cancelTrimmingDialogMessage"))
          builder.setTitle(editorConfig?.getString("cancelTrimmingDialogTitle"))
          builder.setCancelable(false)
          builder.setPositiveButton(editorConfig?.getString("cancelTrimmingDialogConfirmText")) { _: DialogInterface?, _: Int ->
            trimmerView?.onCancelTrimClicked()
            if (mProgressDialog?.isShowing == true) {
              mProgressDialog?.dismiss()
            }
          }
          builder.setNegativeButton(
            editorConfig?.getString("cancelTrimmingDialogCancelText") ?: "Close"
          ) { dialog: DialogInterface, _: Int ->
            dialog.cancel()
          }
          cancelTrimmingConfirmDialog = builder.create()
          cancelTrimmingConfirmDialog?.show()
        } else {
          trimmerView?.onCancelTrimClicked()

          if (mProgressDialog?.isShowing == true) {
            mProgressDialog?.dismiss()
          }
        }
      }
      layout.addView(button)
    }

    // Create the AlertDialog
    val builder = AlertDialog.Builder(
      activity
    )
    builder.setCancelable(false)
    builder.setView(layout)

    // Show the dialog
    mProgressDialog = builder.create()

    mProgressDialog?.setOnShowListener {
      sendEvent("onStartTrimming", null)
      trimmerView?.onSaveClicked()
    }

    mProgressDialog?.show()
  }

  private fun hideDialog(shouldCloseEditor: Boolean) {
    cancelTrimmingConfirmDialog?.let {
      if (it.isShowing) it.dismiss()
      cancelTrimmingConfirmDialog = null
    }

    mProgressDialog?.let {
      if (it.isShowing) it.dismiss()
      mProgressBar = null
      mProgressDialog = null
    }

    if (shouldCloseEditor) {
      alertDialog?.let {
        if (it.isShowing) it.dismiss()
        alertDialog = null
      }
    }

    if (shouldChangeStatusBarColorOnOpen) {
      restoreStatusBarColor()
    }
  }

  fun listFiles(promise: Promise) {
    promise.resolve(Arguments.fromArray(StorageUtil.listFiles(reactApplicationContext)))
  }

  fun cleanFiles(promise: Promise) {
    val files = StorageUtil.listFiles(reactApplicationContext)
    var successCount = 0
    for (file in files) {
      val state = StorageUtil.deleteFile(file)
      if (state) {
        successCount++
      }
    }

    promise.resolve(successCount.toDouble())
  }

  fun deleteFile(filePath: String, promise: Promise) {
    promise.resolve(StorageUtil.deleteFile(filePath))
  }

  fun closeEditor() {
    hideDialog(true)
  }

  fun isValidFile(url: String, promise: Promise) {
    MediaMetadataUtil.checkFileValidity(url) { isValid: Boolean, fileType: String, duration: Long ->
      if (isValid) {
        Log.d(TAG, "Valid $fileType file with duration: $duration milliseconds")
      } else {
        Log.d(TAG, "Invalid file")
      }
      // Create a FileValidationResult object

      val result = Arguments.createMap()
      result.putBoolean("isValid", isValid)
      result.putString("fileType", fileType)
      result.putDouble("duration", duration.toDouble())

      promise.resolve(result)
    }
  }

  fun trim(url: String, options: ReadableMap?, promise: Promise) {
    val currentDate = Date()
    val dateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ")

    dateFormat.timeZone = TimeZone.getTimeZone("UTC")
    val formattedDateTime = dateFormat.format(currentDate)
    val startTime = options?.getDouble("startTime") ?: 0.0
    val endTime = options?.getDouble("endTime") ?: 1000.0

    val removeAudio = options?.hasKey("removeAudio") == true && options.getBoolean("removeAudio")
    val speed = if (options?.hasKey("speed") == true) options.getDouble("speed") else 1.0

    val outputFile = StorageUtil.getOutputPath(reactApplicationContext, options?.getString("outputExt") ?: "mp4")

    val resolvedOutputFile = outputFile

    // Headless trim: no editor UI, so no transforms (flip/rotate/crop) are possible.
    // Re-encode for enablePreciseTrimming (frame-accurate cuts) or non-1.0 speed (filters + atempo).
    val enablePrecise = options?.hasKey("enablePreciseTrimming") == true &&
      options.getBoolean("enablePreciseTrimming")
    val needsReEncode = enablePrecise || speed != 1.0

    // Headless trim still benefits from the encoder fallback chain whenever it
    // re-encodes (hardware encoder failures are device-specific, not path-specific).
    // No-op log/stats/progress callbacks because headless trim returns via Promise
    // rather than emitting events.
    val onSuccess: () -> Unit = {
      val duration = endTime - startTime
      val result = Arguments.createMap()
      result.putString("outputPath", resolvedOutputFile)
      result.putDouble("startTime", startTime)
      result.putDouble("endTime", endTime)
      result.putDouble("duration", duration)
      result.putBoolean("success", true)

      if (options?.getBoolean("saveToPhoto") == true && options.getString("type") == "video") {
        Log.d(TAG, "Android trim: saveToPhoto is true, attempting to save to gallery")
        try {
          StorageUtil.saveToGallery(reactApplicationContext, resolvedOutputFile)
          Log.d(TAG, "Edited video saved to Photo Library successfully.")
          if (options.getBoolean("removeAfterSavedToPhoto")) {
            Log.d(TAG, "Removing file after successful save to photo")
            StorageUtil.deleteFile(resolvedOutputFile)
          }
          promise.resolve(result)
        } catch (e: IOException) {
          e.printStackTrace()
          if (options.getBoolean("removeAfterFailedToSavePhoto")) {
            Log.d(TAG, "Removing file after failed save to photo")
            StorageUtil.deleteFile(resolvedOutputFile)
          }
          promise.reject(
            Exception("Failed to save edited video to Photo Library: " + e.localizedMessage)
          )
        }
      } else {
        Log.d(TAG, "Android trim: saveToPhoto is false or not video type, resolving with structured result")
        promise.resolve(result)
      }
    }

    val callbacks = VideoTrimmerUtil.TrimCallbacks(
      onLog = { msg -> msg.getString("message")?.let { Log.d(TAG, it) } },
      onStatistics = { /* headless trim does not surface statistics */ },
      onProgress = { /* headless trim does not surface progress */ },
      onSuccess = onSuccess,
      onCancel = {
        println("FFmpeg command was cancelled")
        promise.reject(Exception("FFmpeg command was cancelled"))
      },
      onError = { errorMessage, _, _ ->
        Log.d(TAG, errorMessage)
        promise.reject(Exception(errorMessage))
      },
    )

    if (!needsReEncode) {
      // Stream copy: no encoder is opened so the fallback chain doesn't apply.
      // -y overwrites any pre-existing output file without prompting.
      val cmds = mutableListOf(
        "-y",
        "-ss", "${startTime}ms",
        "-to", "${endTime}ms",
        "-i", url,
      )
      if (removeAudio) {
        cmds.addAll(listOf("-c:v", "copy", "-an"))
      } else {
        cmds.addAll(listOf("-c", "copy"))
      }
      cmds.addAll(listOf("-metadata", "creation_time=$formattedDateTime", resolvedOutputFile))
      VideoTrimmerUtil.executeWithEncoderFallback(
        encoderConfigs = listOf(VideoTrimmerUtil.EncoderConfig(emptyList())),
        buildCommand = { cmds.toTypedArray() },
        videoDurationMs = 0,
        callbacks = callbacks,
      )
      return
    }

    var bitrateStr = "10M"
    try {
      val retriever = MediaMetadataRetriever()
      retriever.setDataSource(reactApplicationContext, Uri.parse(url))
      val bitrate = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)
        ?.toLongOrNull() ?: 0L
      if (bitrate > 0) bitrateStr = "$bitrate"
      retriever.release()
    } catch (_: Exception) {}

    val buildCommand: (VideoTrimmerUtil.EncoderConfig) -> Array<String> = { config ->
      // -y overwrites the output file without prompting, so the encoder fallback
      // chain's software retry can reuse the same output path left behind by the
      // failed hardware attempt instead of aborting on FFmpeg's overwrite prompt.
      val cmds = mutableListOf(
        "-y",
        "-ss", "${startTime}ms",
        "-to", "${endTime}ms",
        "-i", url,
      )
      // Per-attempt filter chain: optional speed retime plus, on the mpeg4 software
      // fallback only, a resolution cap so the output is decodable on-device.
      val attemptFilters = mutableListOf<String>()
      if (speed != 1.0) {
        attemptFilters.add("setpts=${1.0 / speed}*PTS")
      }
      config.maxLongSide?.let { attemptFilters.add(VideoTrimmerUtil.capLongSideFilter(it)) }
      if (attemptFilters.isNotEmpty()) {
        cmds.addAll(listOf("-vf", attemptFilters.joinToString(",")))
      }
      cmds.addAll(config.args)
      when {
        removeAudio -> cmds.add("-an")
        speed != 1.0 -> cmds.addAll(listOf("-af", VideoTrimmerUtil.buildAtempoChain(speed)))
        else -> cmds.addAll(listOf("-c:a", "copy"))
      }
      // Same high-tbr fix as compress: prevents duplicate DTS on sources like Pixel 7
      // recordings (45k tbr) when re-encoding with h264_mediacodec.
      cmds.addAll(listOf("-fps_mode", "vfr", "-metadata", "creation_time=$formattedDateTime", resolvedOutputFile))
      cmds.toTypedArray()
    }

    VideoTrimmerUtil.executeWithEncoderFallback(
      encoderConfigs = VideoTrimmerUtil.reEncodeEncoderConfigs(bitrateStr),
      buildCommand = buildCommand,
      videoDurationMs = 0,
      callbacks = callbacks,
    )
  }

  // Extracts a single video frame as JPEG/PNG. Output goes to the cache directory.
  // On API 27+ (O_MR1), uses getScaledFrameAtTime with the video's native dimensions
  // to get full-resolution frames. The plain getFrameAtTime() on older APIs may return
  // a reduced-resolution bitmap at the decoder's discretion.
  fun getFrameAt(url: String, options: ReadableMap?, promise: Promise) {
    Thread {
      try {
        val time = options?.getDouble("time")?.toLong() ?: 0L
        val format = options?.getString("format") ?: "jpeg"
        val quality = options?.getInt("quality") ?: 80
        val maxWidth = options?.getInt("maxWidth") ?: -1
        val maxHeight = options?.getInt("maxHeight") ?: -1

        val retriever = MediaMetadataUtil.getMediaMetadataRetriever(url)
        if (retriever == null) {
          UiThreadUtil.runOnUiThread { promise.reject(Exception("Failed to load media")) }
          return@Thread
        }

        val videoWidth = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
        val videoHeight = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0

        var bitmap: Bitmap? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1 && videoWidth > 0 && videoHeight > 0) {
          retriever.getScaledFrameAtTime(time * 1000, MediaMetadataRetriever.OPTION_CLOSEST, videoWidth, videoHeight)
        } else {
          retriever.getFrameAtTime(time * 1000, MediaMetadataRetriever.OPTION_CLOSEST)
        }
        retriever.release()

        if (bitmap == null) {
          UiThreadUtil.runOnUiThread { promise.reject(Exception("Failed to extract frame")) }
          return@Thread
        }

        if (maxWidth > 0 || maxHeight > 0) {
          val origW = bitmap.width
          val origH = bitmap.height
          var targetW = if (maxWidth > 0) maxWidth else origW
          var targetH = if (maxHeight > 0) maxHeight else origH

          val ratioW = targetW.toFloat() / origW
          val ratioH = targetH.toFloat() / origH
          val ratio = min(min(ratioW, ratioH), 1f)

          targetW = (origW * ratio).toInt()
          targetH = (origH * ratio).toInt()

          if (targetW != origW || targetH != origH) {
            bitmap = Bitmap.createScaledBitmap(bitmap, targetW, targetH, true)
          }
        }

        val ext = if (format == "png") "png" else "jpg"
        val timestamp = System.currentTimeMillis() / 1000
        val file = File(reactApplicationContext.cacheDir, "${VideoTrimmerUtil.FILE_PREFIX}_frame_${timestamp}.$ext")

        val outputStream = FileOutputStream(file)
        if (format == "png") {
          bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
        } else {
          bitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)
        }
        outputStream.close()

        val result = Arguments.createMap()
        result.putString("outputPath", file.absolutePath)
        UiThreadUtil.runOnUiThread { promise.resolve(result) }
      } catch (e: Exception) {
        UiThreadUtil.runOnUiThread { promise.reject(Exception("Frame extraction failed: ${e.message}")) }
      }
    }.start()
  }

  // Strips the video track via FFmpeg -vn. Default output is m4a (AAC) because the
  // default FFmpegKit builds do not include libmp3lame for mp3 encoding.
  fun extractAudio(url: String, options: ReadableMap?, promise: Promise) {
    val outputExt = options?.getString("outputExt") ?: "m4a"
    val outputFile = StorageUtil.getCacheOutputPath(reactApplicationContext, outputExt)

    val cmds = arrayOf("-i", url, "-vn", "-y", outputFile)
    Log.d(TAG, "extractAudio command: ${cmds.joinToString(" ")}")

    FFmpegKit.executeWithArgumentsAsync(cmds, { session ->
      val returnCode = session.returnCode
      UiThreadUtil.runOnUiThread {
        if (ReturnCode.isSuccess(returnCode)) {
          val retriever = MediaMetadataRetriever()
          var duration = 0.0
          try {
            retriever.setDataSource(outputFile)
            duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0
            retriever.release()
          } catch (_: Exception) {
          }

          val result = Arguments.createMap()
          result.putString("outputPath", outputFile)
          result.putDouble("duration", duration)
          promise.resolve(result)
        } else {
          val logs = session.allLogsAsString ?: ""
          promise.reject(Exception("Extract audio failed: rc $returnCode\n$logs"))
        }
      }
    }, null, null)
  }

  // Re-encodes video with h264_mediacodec (hardware) at the requested quality/bitrate.
  // Uses preset bitrate tiers for quality levels since Android's MediaCodec does not
  // support CRF-style quality control like VideoToolbox's -global_quality on iOS.
  // Routed through VideoTrimmerUtil.executeWithEncoderFallback so the encoder
  // fallback chain (h264_mediacodec → mpeg4) covers this path too — see README's
  // "Android encoder compatibility" section.
  fun compress(url: String, options: ReadableMap?, promise: Promise) {
    val quality = options?.getString("quality") ?: "medium"
    val bitrate = options?.getDouble("bitrate") ?: -1.0
    val width = options?.getInt("width") ?: -1
    val height = options?.getInt("height") ?: -1
    val frameRate = options?.getDouble("frameRate") ?: -1.0
    val outputExt = options?.getString("outputExt") ?: "mp4"
    val removeAudio = options?.hasKey("removeAudio") == true && options.getBoolean("removeAudio")

    val outputFile = StorageUtil.getCacheOutputPath(reactApplicationContext, outputExt)

    val videoFilters = mutableListOf<String>()
    if (width > 0 && height > 0) {
      videoFilters.add("scale=$width:$height")
    } else if (width > 0) {
      videoFilters.add("scale=$width:-2")
    } else if (height > 0) {
      videoFilters.add("scale=-2:$height")
    }

    val bitrateStr = if (bitrate > 0) "${bitrate.toLong()}" else when (quality) {
      "low" -> "500K"
      "high" -> "5M"
      else -> "2M"
    }

    val buildCommand: (VideoTrimmerUtil.EncoderConfig) -> Array<String> = { config ->
      val cmds = mutableListOf("-i", url)
      // Per-attempt filter chain: any user-requested scale plus, on the mpeg4 software
      // fallback only, a resolution cap so the output is decodable on-device. Android's
      // software MPEG-4 decoder rejects full-resolution mpeg4 (NO_EXCEEDS_CAPABILITIES).
      val attemptFilters = videoFilters.toMutableList()
      config.maxLongSide?.let { attemptFilters.add(VideoTrimmerUtil.capLongSideFilter(it)) }
      if (attemptFilters.isNotEmpty()) {
        cmds.addAll(listOf("-vf", attemptFilters.joinToString(",")))
      }
      cmds.addAll(config.args)
      if (frameRate > 0) {
        cmds.addAll(listOf("-r", "$frameRate"))
      }
      if (removeAudio) {
        cmds.add("-an")
      } else {
        cmds.addAll(listOf("-c:a", "aac"))
      }
      // -fps_mode vfr prevents frame duplication / non-monotonic DTS errors that
      // occur when the source has an unusually high time-base (e.g. Pixel 7 recordings
      // with 45k tbr). Without this, h264_mediacodec tries to encode at the tbr rate,
      // producing hundreds of duplicate frames and then a fatal muxer DTS collision.
      cmds.addAll(listOf("-fps_mode", "vfr", "-y", outputFile))
      cmds.toTypedArray()
    }

    val callbacks = VideoTrimmerUtil.TrimCallbacks(
      onLog = { msg -> msg.getString("message")?.let { Log.d(TAG, "compress: $it") } },
      onStatistics = { /* compress does not surface statistics */ },
      onProgress = { /* compress does not surface progress */ },
      onSuccess = {
        val result = Arguments.createMap()
        result.putString("outputPath", outputFile)
        promise.resolve(result)
      },
      onCancel = { promise.reject(Exception("Compression was cancelled")) },
      onError = { _, _, session ->
        // Preserve the original error message shape: "Compression failed: rc N\n<full logs>"
        // so consumers matching on this prefix continue to work.
        val returnCode = session?.returnCode
        val logs = session?.allLogsAsString ?: ""
        promise.reject(Exception("Compression failed: rc $returnCode\n$logs"))
      },
    )

    VideoTrimmerUtil.executeWithEncoderFallback(
      encoderConfigs = VideoTrimmerUtil.reEncodeEncoderConfigs(bitrateStr),
      buildCommand = buildCommand,
      videoDurationMs = 0,
      callbacks = callbacks,
    )
  }

  // Two-pass GIF conversion: pass 1 generates an optimal color palette (palettegen),
  // pass 2 encodes the GIF using that palette (paletteuse) for better color accuracy.
  fun toGif(url: String, options: ReadableMap?, promise: Promise) {
    val startTime = options?.getDouble("startTime") ?: 0.0
    val endTime = options?.getDouble("endTime") ?: -1.0
    val fps = options?.getInt("fps") ?: 10
    val width = options?.getInt("width") ?: -1

    val timestamp = System.currentTimeMillis() / 1000
    val paletteFile = File(reactApplicationContext.cacheDir, "${VideoTrimmerUtil.FILE_PREFIX}_palette_${timestamp}.png")
    val outputFile = File(reactApplicationContext.cacheDir, "${VideoTrimmerUtil.FILE_PREFIX}_gif_${timestamp}.gif")

    val scaleExpr = if (width > 0) "$width:-1" else "-1:-1"
    val filterBase = "fps=$fps,scale=$scaleExpr:flags=lanczos"

    val timeArgs = mutableListOf<String>()
    if (startTime > 0) {
      timeArgs.addAll(listOf("-ss", "${startTime}ms"))
    }
    if (endTime > 0) {
      timeArgs.addAll(listOf("-to", "${endTime}ms"))
    }

    val pass1 = (timeArgs + listOf("-i", url, "-vf", "$filterBase,palettegen", "-y", paletteFile.absolutePath)).toTypedArray()
    Log.d(TAG, "toGif pass1 command: ${pass1.joinToString(" ")}")

    FFmpegKit.executeWithArgumentsAsync(pass1, { session ->
      if (!ReturnCode.isSuccess(session.returnCode)) {
        paletteFile.delete()
        val logs = session.allLogsAsString ?: ""
        UiThreadUtil.runOnUiThread { promise.reject(Exception("GIF palette generation failed\n$logs")) }
        return@executeWithArgumentsAsync
      }

      val pass2 = (
        timeArgs + listOf(
          "-i", url, "-i", paletteFile.absolutePath, "-lavfi",
          "$filterBase [x]; [x][1:v] paletteuse",
          "-y",
          outputFile.absolutePath
        )
        ).toTypedArray()
      Log.d(TAG, "toGif pass2 command: ${pass2.joinToString(" ")}")

      FFmpegKit.executeWithArgumentsAsync(pass2, { session2 ->
        paletteFile.delete()
        UiThreadUtil.runOnUiThread {
          if (ReturnCode.isSuccess(session2.returnCode)) {
            val result = Arguments.createMap()
            result.putString("outputPath", outputFile.absolutePath)
            promise.resolve(result)
          } else {
            val logs = session2.allLogsAsString ?: ""
            promise.reject(Exception("GIF creation failed\n$logs"))
          }
        }
      }, null, null)
    }, null, null)
  }

  // Concatenates multiple local video files using FFmpeg's concat *filter* (not demuxer).
  // Each input is normalized to the first clip's resolution via scale+pad+setsar+format
  // before entering the concat, so clips with different dimensions, pixel formats, or SARs
  // merge correctly (mismatched inputs get letterboxed/pillarboxed with black bars).
  //
  // Bitrate: probes all input videos via MediaMetadataRetriever and uses the highest
  // detected bitrate as the output target so quality matches the best source clip.
  // Falls back to 10 Mbps if no bitrate can be read.
  //
  // Routed through VideoTrimmerUtil.executeWithEncoderFallback so the encoder
  // fallback chain (h264_mediacodec → mpeg4) covers this path too — see README's
  // "Android encoder compatibility" section.
  //
  // Limitation: only supports local file paths. Remote URLs are not supported because the
  // default FFmpegKit build does not include OpenSSL (--disable-openssl).
  fun merge(urls: ReadableArray, options: ReadableMap?, promise: Promise) {
    val outputExt = options?.getString("outputExt") ?: "mp4"
    val outputFile = StorageUtil.getCacheOutputPath(reactApplicationContext, outputExt)

    val n = urls.size()
    if (n == 0) {
      promise.reject(Exception("No input URLs"))
      return
    }

    val inputArgs = mutableListOf<String>()
    var maxBitrate = 0L
    for (i in 0 until n) {
      val urlStr = urls.getString(i) ?: continue
      inputArgs.addAll(listOf("-i", urlStr))
      try {
        val retriever = MediaMetadataRetriever()
        retriever.setDataSource(reactApplicationContext, Uri.parse(urlStr))
        val bitrate = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toLongOrNull() ?: 0L
        if (bitrate > maxBitrate) maxBitrate = bitrate
        retriever.release()
      } catch (_: Exception) {}
    }
    val bitrateStr = if (maxBitrate > 0) "$maxBitrate" else "10M"

    // Use the first clip's dimensions and frame rate as the target for all inputs.
    var targetW = 1280; var targetH = 720
    var targetFps = 30
    try {
      val retriever = MediaMetadataRetriever()
      retriever.setDataSource(reactApplicationContext, Uri.parse(urls.getString(0)))
      targetW = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 1280
      targetH = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 720
      val fpsStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE)
      val fps = fpsStr?.toDoubleOrNull()?.let { kotlin.math.ceil(it).toInt() } ?: 30
      targetFps = fps.coerceIn(1, 30)
      retriever.release()
    } catch (_: Exception) {}

    val buildCommand: (VideoTrimmerUtil.EncoderConfig) -> Array<String> = { config ->
      // On the mpeg4 software fallback only, clamp the normalization target so the
      // long side stays within what Android's software MPEG-4 decoder can play back.
      // merge scales via -filter_complex (not -vf), so the cap is applied to the
      // target dimensions rather than appended as an extra filter.
      val (outW, outH) = config.maxLongSide
        ?.let { VideoTrimmerUtil.capDimensionsToLongSide(targetW, targetH, it) }
        ?: (targetW to targetH)

      // Normalize each input to the same resolution, pixel format, SAR, and frame rate
      // before concat. The fps filter prevents massive frame duplication when inputs have
      // very different frame rates (e.g. 24fps + 60fps would cause thousands of dupes).
      val scaleFilter = "scale=$outW:$outH:force_original_aspect_ratio=decrease,pad=$outW:$outH:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,fps=$targetFps"
      val scaleParts = (0 until n).joinToString(";") { "[$it:v:0]${scaleFilter}[v$it]" }
      val concatInputs = (0 until n).joinToString("") { "[v$it][$it:a:0]" }
      val filterComplex = "$scaleParts;${concatInputs}concat=n=$n:v=1:a=1[outv][outa]"

      val cmds = mutableListOf<String>()
      cmds.addAll(inputArgs)
      cmds.addAll(listOf(
        "-filter_complex", filterComplex,
        "-map", "[outv]", "-map", "[outa]",
      ))
      cmds.addAll(config.args)
      cmds.addAll(listOf(
        "-c:a", "aac",
        "-y", outputFile,
      ))
      cmds.toTypedArray()
    }

    val callbacks = VideoTrimmerUtil.TrimCallbacks(
      onLog = { msg -> msg.getString("message")?.let { Log.d(TAG, "merge: $it") } },
      onStatistics = { /* merge does not surface statistics */ },
      onProgress = { /* merge does not surface progress */ },
      onSuccess = {
        var duration = 0.0
        try {
          val retriever = MediaMetadataRetriever()
          retriever.setDataSource(outputFile)
          duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0
          retriever.release()
        } catch (_: Exception) {
        }
        val result = Arguments.createMap()
        result.putString("outputPath", outputFile)
        result.putDouble("duration", duration)
        promise.resolve(result)
      },
      onCancel = { promise.reject(Exception("Merge was cancelled")) },
      onError = { _, _, session ->
        // Preserve the original error message shape: "Merge failed: rc N\n<full logs>"
        // so consumers matching on this prefix continue to work.
        val returnCode = session?.returnCode
        val logs = session?.allLogsAsString ?: ""
        promise.reject(Exception("Merge failed: rc $returnCode\n$logs"))
      },
    )

    VideoTrimmerUtil.executeWithEncoderFallback(
      encoderConfigs = VideoTrimmerUtil.reEncodeEncoderConfigs(bitrateStr),
      buildCommand = buildCommand,
      videoDurationMs = 0,
      callbacks = callbacks,
    )
  }

  // Composites multiple clips into a single grid video — real per-clip
  // positioning and sizing (including a "featured clip above a smaller
  // grid" layout) is computed in JS (mirrors the logic already proven out
  // in the browser bookmarklet version of this tool, verified there against
  // real ffmpeg); this method just takes the already-computed per-clip
  // boxes and turns them into one FFmpeg command; no grid math happens here.
  //
  // Uses an explicit black background plus chained `overlay` filters rather
  // than `xstack` — confirmed directly (against real ffmpeg, in the
  // bookmarklet version) that xstack leaves any canvas area no input covers
  // as uninitialized memory rather than actually black, which rendered as
  // bright green in exactly the gaps a non-perfectly-divisible clip count
  // produces. `overlay` with an explicit `color=black` base avoids that
  // entirely and also composes cleanly with mixed-size boxes.
  //
  // Same local-file-only limitation as merge() above, same reason (no
  // OpenSSL in this FFmpegKit build) — callers must download clips first.
  // Renders a small transparent PNG containing wrapped, capped label text
  // for one grid cell, using Android's own TextPaint/Canvas — the same
  // rendering engine every view in the OS draws text with — instead of
  // ffmpeg's drawtext filter, which needs libfreetype (only bundled in
  // FFmpegKit's "video"/"full" package variants, not the "min" variant this
  // app uses, which would mean a meaningfully bigger APK just for this one
  // feature). The PNG becomes an ordinary extra ffmpeg input, composited
  // onto its clip via `overlay` — a core filter already used for the grid
  // itself, present in every FFmpegKit variant.
  //
  // Wrapping is a manual greedy token-packing loop — the same algorithm
  // already verified in the bookmarklet's browser version — measuring each
  // candidate with TextPaint.measureText() and breaking only BETWEEN
  // tokens (whole animator names, or whole words for custom text), never
  // within one. Because this measures with the exact engine that renders
  // the final bitmap, there's no cross-renderer metrics gap to compensate
  // for the way the bookmarklet needed (confirmed there that Canvas vs.
  // freetype could disagree by a wide margin) — here the same TextPaint
  // object does both jobs, so no safety-margin percentage is needed either.
  private fun renderLabelBitmap(
    tokens: List<String>,
    joiner: String,
    cellW: Int,
    cellH: Int,
    position: String, // "left" | "right"
    style: String // "outline" | "box"
  ): Bitmap {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      typeface = Typeface.DEFAULT_BOLD
    }
    val marginPx = 10f
    val maxLineWidth = cellW - 2 * marginPx
    val maxLines = 4

    fun wrapAt(size: Float): List<String> {
      paint.textSize = size
      val lines = mutableListOf<String>()
      var current = ""
      for (tok in tokens) {
        val candidate = if (current.isEmpty()) tok else current + joiner + tok
        if (current.isEmpty() || paint.measureText(candidate) <= maxLineWidth) {
          current = candidate
        } else {
          lines.add(current)
          current = tok
        }
      }
      if (current.isNotEmpty()) lines.add(current)
      return lines
    }

    // Divisor/clamp chosen against this tool's actual cell sizes (270 for a
    // normal cell, up to 540 for a doubled 'stretch' featured box or a
    // serial-mode frame) — same numbers already verified in the bookmarklet
    // to actually differentiate between them (18 vs 32), rather than both
    // landing on one clamped ceiling the way an earlier, narrower range did.
    var fontSize = (cellH / 15f).coerceIn(14f, 32f)
    var lines = wrapAt(fontSize)
    while (lines.size > maxLines && fontSize > 12f) {
      fontSize -= 1f
      lines = wrapAt(fontSize)
    }

    val bitmap = Bitmap.createBitmap(cellW, cellH, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap) // starts fully transparent — nothing drawn shows through as-is

    val lineHeight = paint.fontSpacing
    val totalTextHeight = lineHeight * lines.size
    var y = cellH - marginPx - totalTextHeight - paint.ascent()

    val boxPaint = Paint().apply { color = Color.argb(128, 0, 0, 0) }
    val strokePaint = TextPaint(paint).apply {
      style = Paint.Style.STROKE
      strokeWidth = fontSize * 0.11f
      color = Color.BLACK
    }

    for (line in lines) {
      val textWidth = paint.measureText(line)
      val x = if (position == "right") cellW - marginPx - textWidth else marginPx
      if (style == "box") {
        canvas.drawRect(x - 6, y + paint.ascent() - 4, x + textWidth + 6, y + paint.descent() + 4, boxPaint)
      } else {
        canvas.drawText(line, x, y, strokePaint)
      }
      canvas.drawText(line, x, y, paint)
      y += lineHeight
    }
    return bitmap
  }

  private fun saveLabelBitmap(bitmap: Bitmap): String {
    val file = File(reactApplicationContext.cacheDir, "sk_label_${System.nanoTime()}.png")
    FileOutputStream(file).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
    bitmap.recycle()
    return file.absolutePath
  }

  fun exportGrid(clips: ReadableArray, options: ReadableMap?, promise: Promise) {
    val outputExt = options?.getString("outputExt") ?: "mp4"
    val outputFile = StorageUtil.getCacheOutputPath(reactApplicationContext, outputExt)
    val canvasW = options?.getInt("canvasWidth") ?: 0
    val canvasH = options?.getInt("canvasHeight") ?: 0
    val targetDurationMs = options?.getDouble("targetDurationMs") ?: 0.0
    val targetDurationSec = targetDurationMs / 1000.0
    // "grid" (default) composites every clip into one shared frame at once;
    // "serial" concatenates them one after another in time instead — same
    // per-clip scale+pad+trim+loop pipeline either way, just a different
    // final assembly step (overlay chain vs. a single concat filter).
    val format = options?.getString("format") ?: "grid"
    val isSerial = format == "serial"

    val n = clips.size()
    if (n < 2 || canvasW <= 0 || canvasH <= 0 || targetDurationSec <= 0) {
      promise.reject(Exception("exportGrid: need at least 2 clips and valid canvas/duration"))
      return
    }

    val clipMaps = arrayOfNulls<ReadableMap>(n)
    // Effective path per clip — starts as the original path, replaced with
    // an extracted-segment temp file for any clip that specifies a trim range.
    val effectivePaths = arrayOfNulls<String>(n)
    val extractedFiles = mutableListOf<String>() // tracked separately for cleanup once done
    for (i in 0 until n) {
      val clip = clips.getMap(i)
      val path = clip?.getString("path")
      if (path.isNullOrEmpty()) {
        promise.reject(Exception("exportGrid: clip $i missing path"))
        return
      }
      clipMaps[i] = clip
      effectivePaths[i] = path
    }

    // Recursively extracts any trimmed clips' sub-ranges to their own files
    // before compositing. Same reasoning as the already-verified bookmarklet
    // fix: combining -stream_loop with input-side -ss/-t on the SAME input
    // either has no looping effect at all, or (seeking after -i instead)
    // loops the WHOLE original clip and just starts playback at an offset —
    // meaning a trimmed selection would eventually drift into showing
    // content outside the chosen range once the target duration ran long
    // enough. Extracting the sub-range to its own file first, then looping
    // THAT file like any other input, is the only approach confirmed to
    // actually repeat just the selected segment indefinitely.
    fun extractNext(index: Int, onDone: () -> Unit) {
      if (index >= n) { onDone(); return }
      val clip = clipMaps[index]!!
      val hasTrim = clip.hasKey("trimStartSec") && clip.hasKey("trimDurationSec")
      if (!hasTrim) { extractNext(index + 1, onDone); return }
      val trimStart = clip.getDouble("trimStartSec")
      val trimDuration = clip.getDouble("trimDurationSec")
      val extractedFile = StorageUtil.getCacheOutputPath(reactApplicationContext, "mp4")

      // Hardware mediacodec encoder first, software mpeg4 fallback second —
      // same two encoders (and same reasoning) already used everywhere else
      // in this file via reEncodeEncoderConfigs. NOT libx264: confirmed via
      // a real device failure ("Unrecognized option 'preset'") that this
      // FFmpegKit build doesn't actually include it — every other call site
      // in this file already knew that and avoided it; this extraction path
      // originally didn't and was the one place that broke on a real build.
      fun attempt(useSoftwareFallback: Boolean) {
        val encoderArgs = if (!useSoftwareFallback) {
          listOf("-c:v", "h264_mediacodec", "-b:v", "6M")
        } else {
          listOf("-c:v", "mpeg4", "-q:v", "3", "-pix_fmt", "yuv420p")
        }
        val extractCmds = (
          listOf("-ss", trimStart.toString(), "-t", trimDuration.toString(), "-i", effectivePaths[index]!!) +
          encoderArgs +
          listOf("-y", extractedFile)
        ).toTypedArray()
        Log.d(TAG, "exportGrid trim-extract[$index] command: ${extractCmds.joinToString(" ")}")
        FFmpegKit.executeWithArgumentsAsync(extractCmds, { session ->
          if (ReturnCode.isSuccess(session.returnCode)) {
            effectivePaths[index] = extractedFile
            extractedFiles.add(extractedFile)
            extractNext(index + 1, onDone)
          } else if (!useSoftwareFallback) {
            attempt(true)
          } else {
            val logs = session.allLogsAsString ?: ""
            UiThreadUtil.runOnUiThread {
              promise.reject(Exception("exportGrid: trim extraction failed for clip $index\n$logs"))
            }
          }
        }, null, null)
      }
      attempt(false)
    }

    extractNext(0) {
      val inputArgs = mutableListOf<String>()
      val filterParts = mutableListOf<String>()
      // Explicit black background, then chained `overlay` filters instead
      // of `xstack` for grid mode — confirmed directly (against real
      // ffmpeg, in the bookmarklet version of this feature) that xstack
      // leaves any canvas area no input covers as uninitialized memory
      // rather than actually black, which rendered as bright green in
      // exactly the gaps a "center leftover row" layout produces. Serial
      // mode needs none of this — concat has no gaps to cover, every clip
      // fills the one shared frame completely in its own turn.
      if (!isSerial) {
        filterParts.add("color=c=black:s=${canvasW}x${canvasH}:r=24[bg]")
      }

      for (i in 0 until n) {
        val clip = clipMaps[i]!!
        val needsLoop = clip.hasKey("needsLoop") && clip.getBoolean("needsLoop")
        val w = clip.getInt("w")
        val h = clip.getInt("h")
        // stopExtendSec present means "freeze on the last frame instead of
        // looping" for this clip — set by the JS side only when needsLoop
        // was true AND the person chose Stop mode. Same tpad approach
        // already verified in the bookmarklet version: combining
        // -stream_loop with input-side seeking on the same source doesn't
        // repeat just the clip's own content — either it has no looping
        // effect, or it loops the WHOLE original and just starts playback
        // at an offset. tpad's clone mode genuinely holds the last frame.
        // (Serial mode never sets needsLoop in the first place — every clip
        // in a sequence just plays through once for its own length.)
        val stopExtendSec = if (clip.hasKey("stopExtendSec")) clip.getDouble("stopExtendSec") else null
        if (needsLoop && stopExtendSec == null) {
          inputArgs.addAll(listOf("-stream_loop", "-1"))
        }
        inputArgs.addAll(listOf("-i", effectivePaths[i]!!))
        // Aspect-preserving scale+pad for every clip, including a featured
        // clip's bigger box or serial mode's single shared frame — sized to
        // the source's own natural aspect ratio (computed in JS), so it's
        // just an ordinary rectangle, not a distorted one; no
        // special-casing needed.
        var chain = "[$i:v]scale=$w:$h:force_original_aspect_ratio=decrease,pad=$w:$h:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=24"
        if (stopExtendSec != null) {
          chain += ",tpad=stop_mode=clone:stop_duration=${"%.2f".format(stopExtendSec)}"
        }
        filterParts.add("$chain[v$i]")
      }

      // Only this clip's own animator tags (or a person's own custom
      // override) get rendered here — bitmaps are generated up front,
      // synchronously, since this is plain Android drawing, not an ffmpeg
      // pass — then composited via a plain `overlay`, same as the grid
      // itself. finalVideoLabels tracks which label ([v$i] or the
      // label-overlaid [v${i}l]) each clip should actually contribute
      // below, so unlabeled clips are completely unaffected.
      val finalVideoLabels = Array(n) { "v$it" }
      val labelPngPaths = mutableListOf<String>()
      var nextInputIndex = n
      for (i in 0 until n) {
        val clip = clipMaps[i]!!
        val tokensArray = if (clip.hasKey("labelTokens")) clip.getArray("labelTokens") else null
        val tokens = tokensArray?.let { arr -> (0 until arr.size()).mapNotNull { arr.getString(it) } } ?: emptyList()
        if (tokens.isEmpty()) continue
        val joiner = if (clip.hasKey("labelJoiner")) clip.getString("labelJoiner") ?: ", " else ", "
        val position = if (clip.hasKey("labelPosition")) clip.getString("labelPosition") ?: "left" else "left"
        val style = if (clip.hasKey("labelStyle")) clip.getString("labelStyle") ?: "outline" else "outline"
        val w = clip.getInt("w")
        val h = clip.getInt("h")
        val bitmap = renderLabelBitmap(tokens, joiner, w, h, position, style)
        val labelPath = saveLabelBitmap(bitmap)
        labelPngPaths.add(labelPath)
        val labelInputIndex = nextInputIndex
        nextInputIndex += 1
        // -loop 1 tells ffmpeg to treat this still image as an infinitely
        // repeating single frame — the standard, documented way to combine
        // a static image with video via overlay. Without it, how long an
        // image "lasts" as an input is version/build-dependent behavior,
        // and this FFmpegKit build is a different, older ffmpeg version
        // than what this was tested against directly — worth being
        // explicit here rather than relying on an unspecified default.
        inputArgs.addAll(listOf("-loop", "1", "-i", labelPath))
        // shortest=1 is the necessary companion to -loop 1 above — without
        // it, confirmed directly (against real ffmpeg) that this combination
        // can hang indefinitely rather than terminate once the (finite)
        // video input ends, since the looped image on its own has no
        // natural end for ffmpeg to synchronize against. With it, the
        // overlay correctly ends exactly when the shorter (video) input does.
        filterParts.add("[v$i][$labelInputIndex:v]overlay=0:0:shortest=1[v${i}l]")
        finalVideoLabels[i] = "v${i}l"
      }

      if (isSerial) {
        // Confirmed directly (against real ffmpeg, in the bookmarklet
        // version, including a mid-sequence trimmed clip) that concat plays
        // each input fully, in order, for its own natural/trimmed length —
        // no explicit background or positions needed, unlike the grid's
        // overlay chain, since nothing ever shares the frame with anything else.
        val concatInputs = (0 until n).joinToString("") { "[${finalVideoLabels[it]}]" }
        filterParts.add("${concatInputs}concat=n=$n:v=1:a=0[outv]")
      } else {
        var prevLabel = "bg"
        for (i in 0 until n) {
          val clip = clipMaps[i]!!
          val x = clip.getInt("x")
          val y = clip.getInt("y")
          val outLabel = if (i == n - 1) "outv" else "t$i"
          filterParts.add("[$prevLabel][${finalVideoLabels[i]}]overlay=$x:$y[$outLabel]")
          prevLabel = outLabel
        }
      }

      val filterComplex = filterParts.joinToString(";")
      Log.d(TAG, "exportGrid main command: n=$n isSerial=$isSerial inputArgs=${inputArgs.joinToString(" ")} filterComplex=$filterComplex")

      // Fixed, reasonable bitrate rather than probing every source clip's
      // bitrate like merge() does — the output is a scaled-down composite
      // (each clip is only a fraction of the canvas), so it doesn't need to
      // match the highest source bitrate the way a straight merge/concat does.
      val buildCommand: (VideoTrimmerUtil.EncoderConfig) -> Array<String> = { config ->
        val cmds = mutableListOf<String>()
        cmds.addAll(inputArgs)
        cmds.add("-filter_complex")
        cmds.add(filterComplex)
        cmds.add("-map")
        cmds.add("[outv]")
        cmds.add("-an")
        // Only grid mode needs an explicit cap — its duration is "however
        // long until every looping/frozen clip has filled the longest one",
        // which needs the -t to actually stop there. Serial mode's own
        // total length already falls out naturally from concatenating each
        // clip's real length once.
        if (!isSerial) {
          cmds.add("-t")
          cmds.add(targetDurationSec.toString())
        }
        cmds.addAll(config.args)
        cmds.addAll(listOf("-y", outputFile))
        cmds.toTypedArray()
      }

    val callbacks = VideoTrimmerUtil.TrimCallbacks(
      onLog = { msg -> msg.getString("message")?.let { Log.d(TAG, "exportGrid: $it") } },
      onStatistics = { /* not surfaced */ },
      onProgress = { /* not surfaced */ },
      onSuccess = {
        var duration = 0.0
        try {
          val retriever = MediaMetadataRetriever()
          retriever.setDataSource(outputFile)
          duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0
          retriever.release()
        } catch (_: Exception) {
        }
        // Best-effort cleanup of the intermediate trim-extraction and label
        // bitmap files — frees cache space; a failure here doesn't affect
        // the result already written to outputFile.
        for (f in extractedFiles) { try { File(f).delete() } catch (_: Exception) {} }
        for (f in labelPngPaths) { try { File(f).delete() } catch (_: Exception) {} }
        val result = Arguments.createMap()
        result.putString("outputPath", outputFile)
        result.putDouble("duration", duration)
        // Temporary diagnostics — the export "succeeds" (no error, no
        // logcat needed) but produces wrong content, so the only way to see
        // the ACTUAL command that ran is to hand it back through the result
        // itself, where it reaches the same Metro console already showing
        // the [gridExport] input logs. Safe to remove once this is solved.
        result.putInt("debugLabelCount", labelPngPaths.size)
        result.putString("debugInputArgs", inputArgs.joinToString(" "))
        result.putString("debugFilterComplex", filterComplex)
        promise.resolve(result)
      },
      onCancel = { promise.reject(Exception("Grid export was cancelled")) },
      onError = { _, _, session ->
        for (f in extractedFiles) { try { File(f).delete() } catch (_: Exception) {} }
        for (f in labelPngPaths) { try { File(f).delete() } catch (_: Exception) {} }
        val returnCode = session?.returnCode
        val logs = session?.allLogsAsString ?: ""
        promise.reject(Exception("Grid export failed: rc $returnCode\n$logs"))
      },
    )

      VideoTrimmerUtil.executeWithEncoderFallback(
        encoderConfigs = VideoTrimmerUtil.reEncodeEncoderConfigs("10M"),
        buildCommand = buildCommand,
        videoDurationMs = targetDurationMs.toInt(),
        callbacks = callbacks,
      )
    }
  }

  // Mixes an external audio track (background music / voice-over) into a video.
  // The video stream is copied unchanged (-c:v copy), so only the audio is
  // re-encoded (to AAC). This keeps the operation fast, preserves video quality,
  // and avoids the hardware-encoder fallback chain that compress/merge require.
  //
  // The original audio and the background audio are combined via the amix filter
  // with independent volume control (normalize=0 so each keeps its set volume).
  // Set originalAudioVolume to 0 to effectively replace the original audio.
  // loopAudio loops the background track (via -stream_loop) so it spans the whole
  // video; -shortest trims the mix to the video length either way. audioStartTime
  // delays the background track by the given milliseconds (adelay).
  //
  // If the source video has no audio track, the background becomes the sole audio
  // and the [0:a] leg is skipped (referencing a missing stream aborts FFmpeg).
  //
  // Limitation: only supports local file paths. Remote URLs are not supported
  // because the default FFmpegKit build does not include OpenSSL.
  fun mixAudio(videoPath: String, audioPath: String, options: ReadableMap?, promise: Promise) {
    val originalAudioVolume = options?.getDouble("originalAudioVolume") ?: 1.0
    val backgroundAudioVolume = options?.getDouble("backgroundAudioVolume") ?: 1.0
    val audioStartTime = options?.getDouble("audioStartTime") ?: 0.0
    val loopAudio = options?.hasKey("loopAudio") == true && options.getBoolean("loopAudio")
    val outputExt = options?.getString("outputExt") ?: "mp4"

    val outputFile = StorageUtil.getCacheOutputPath(reactApplicationContext, outputExt)

    val hasOriginalAudio = try {
      val retriever = MediaMetadataRetriever()
      retriever.setDataSource(videoPath)
      val has = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes"
      retriever.release()
      has
    } catch (_: Exception) {
      false
    }

    val inputArgs = mutableListOf("-i", videoPath)
    if (loopAudio) {
      inputArgs.addAll(listOf("-stream_loop", "-1"))
    }
    inputArgs.addAll(listOf("-i", audioPath))

    // Background leg: optional delay, resample to a common format, apply volume.
    val delayMs = audioStartTime.toLong().coerceAtLeast(0)
    val bgOutLabel = if (hasOriginalAudio) "a1" else "aout"
    val bgFilter = buildString {
      append("[1:a]")
      if (delayMs > 0) append("adelay=$delayMs|$delayMs,")
      append("aresample=async=1,")
      append("volume=$backgroundAudioVolume[$bgOutLabel]")
    }

    val filterComplex = if (hasOriginalAudio) {
      "[0:a]volume=$originalAudioVolume[a0];$bgFilter;[a0][a1]amix=inputs=2:duration=first:normalize=0[aout]"
    } else {
      bgFilter
    }

    val cmds = mutableListOf<String>()
    cmds.addAll(inputArgs)
    cmds.addAll(listOf(
      "-filter_complex", filterComplex,
      "-map", "0:v", "-c:v", "copy",
      "-map", "[aout]", "-c:a", "aac",
      "-shortest", "-y", outputFile,
    ))
    Log.d(TAG, "mixAudio command: ${cmds.joinToString(" ")}")

    FFmpegKit.executeWithArgumentsAsync(cmds.toTypedArray(), { session ->
      val returnCode = session.returnCode
      UiThreadUtil.runOnUiThread {
        if (ReturnCode.isSuccess(returnCode)) {
          var duration = 0.0
          try {
            val retriever = MediaMetadataRetriever()
            retriever.setDataSource(outputFile)
            duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0
            retriever.release()
          } catch (_: Exception) {
          }
          val result = Arguments.createMap()
          result.putString("outputPath", outputFile)
          result.putDouble("duration", duration)
          promise.resolve(result)
        } else {
          // Preserve the shared error message shape: "Mix audio failed: rc N\n<full logs>".
          val logs = session.allLogsAsString ?: ""
          promise.reject(Exception("Mix audio failed: rc $returnCode\n$logs"))
        }
      }
    }, null, null)
  }

  private fun saveFileToExternalStorage(file: File) {
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    intent.type = "*/*" // Change MIME type as needed
    intent.putExtra(Intent.EXTRA_TITLE, file.name)
    reactApplicationContext.currentActivity?.startActivityForResult(intent, REQUEST_CODE_SAVE_FILE)
  }

  private fun shareFile(context: Context, file: File) {
    val fileUri = FileProvider.getUriForFile(
      context,
      context.packageName + FILE_PROVIDER_AUTHORITY_SUFFIX,
      file
    )

    val shareIntent = Intent(Intent.ACTION_SEND)
    shareIntent.type = "*/*"
    shareIntent.putExtra(Intent.EXTRA_STREAM, fileUri)
    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

    // Grant permissions to all applications that can handle the intent
    for (resolveInfo in context.packageManager.queryIntentActivities(
      shareIntent,
      PackageManager.MATCH_DEFAULT_ONLY
    )) {
      val packageName = resolveInfo.activityInfo.packageName
      context.grantUriPermission(packageName, fileUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    // directly use context.startActivity(shareIntent) will cause crash
    reactApplicationContext.currentActivity?.startActivity(Intent.createChooser(shareIntent, "Share file"))
  }

  // Saves a file to the device gallery. Delegates to StorageUtil.saveToGallery which
  // detects image vs video by extension and uses the appropriate MediaStore collection.
  fun saveToPhoto(filePath: String, promise: Promise) {
    try {
      val file = File(filePath)
      if (!file.exists()) {
        promise.reject(Exception("File does not exist at path: $filePath"))
        return
      }
      StorageUtil.saveToGallery(reactApplicationContext, filePath)
      val result = Arguments.createMap()
      result.putBoolean("success", true)
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject(Exception("Failed to save to photo library: ${e.message}"))
    }
  }

  // Opens Android's SAF (Storage Access Framework) document picker via ACTION_CREATE_DOCUMENT
  // so the user can choose where to save. The promise is stored and resolved in onActivityResult.
  fun saveToDocuments(filePath: String, promise: Promise) {
    val file = File(filePath)
    if (!file.exists()) {
      promise.reject(Exception("File does not exist at path: $filePath"))
      return
    }

    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(Exception("No activity available"))
      return
    }

    pendingSaveToDocumentsPromise = promise
    pendingSaveToDocumentsFile = file

    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    intent.type = "*/*"
    intent.putExtra(Intent.EXTRA_TITLE, file.name)
    activity.startActivityForResult(intent, REQUEST_CODE_SAVE_TO_DOCUMENTS)
  }

  // Opens the system share sheet via ACTION_SEND. Uses FileProvider to generate a
  // content:// URI and grants read permission to all potential share targets.
  fun share(filePath: String, promise: Promise) {
    val file = File(filePath)
    if (!file.exists()) {
      promise.reject(Exception("File does not exist at path: $filePath"))
      return
    }

    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(Exception("No activity available"))
      return
    }

    val context: Context = reactApplicationContext
    val fileUri = FileProvider.getUriForFile(
      context,
      context.packageName + FILE_PROVIDER_AUTHORITY_SUFFIX,
      file
    )

    val shareIntent = Intent(Intent.ACTION_SEND)
    shareIntent.type = "*/*"
    shareIntent.putExtra(Intent.EXTRA_STREAM, fileUri)
    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

    for (resolveInfo in context.packageManager.queryIntentActivities(shareIntent, PackageManager.MATCH_DEFAULT_ONLY)) {
      val packageName = resolveInfo.activityInfo.packageName
      context.grantUriPermission(packageName, fileUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    activity.startActivity(Intent.createChooser(shareIntent, "Share file"))

    val result = Arguments.createMap()
    result.putBoolean("success", true)
    promise.resolve(result)
  }

  fun cleanup() {
    reactApplicationContext.removeLifecycleEventListener(this)
  }

  companion object {
    const val NAME = "VideoTrim"
    const val TAG = "VideoTrimModule"
    const val REQUEST_CODE_SAVE_FILE = 1
    const val REQUEST_CODE_SAVE_TO_DOCUMENTS = 2

    // KEEP IN SYNC with android:authorities in AndroidManifest.xml. getUriForFile
    // resolves the provider by authority alone, so a mismatch fails at runtime.
    const val FILE_PROVIDER_AUTHORITY_SUFFIX = ".videotrimprovider"
  }
}