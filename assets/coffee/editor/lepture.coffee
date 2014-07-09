class Lepture

  constructor: (options) ->
    @apiUrl = options.apiUrl
    @storage = options.storage

  initialize: ->
    # Setup lepture
    @editor = new Editor
      element: document.getElementById("content")

    # Allow images to be drag and dropped into the editor.
    @imageUpload @editor

    # Set up the local storage saving when the editor changes.
    @editor.codemirror.on "change", (cm, change) =>
      @storage.put
        content: @getValue()

  # Setup the image uploading into the content editor.
  imageUpload: (editor) ->
    options =
      uploadUrl: @apiUrl + "/dropzone/image"
      allowedTypes: ["image/jpeg", "image/png", "image/jpg", "image/gif"]
      progressText: "![Uploading file...]()"
      urlText: "![file]({filename})"
      # onUploadedFile: (json) ->
      errorText: "Error uploading file"

    # Attach it to the code mirror.
    inlineAttach.attachToCodeMirror(editor.codemirror, options)

  getValue: ->
    @editor.codemirror.getValue()