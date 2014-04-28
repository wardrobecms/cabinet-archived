@Wardrobe.module "DropzoneApp", (DropzoneApp, App, Backbone, Marionette, $, _) ->

  Dropzone.autoDiscover = false

  API =
    setupDropzone: (el, defaultImg = null) ->
      myDropzone = new Dropzone el,
        url: App.request("get:url:api") + "/dropzone/leader"
        method: "POST"
        addRemoveLinks: true
        maxFiles: 1
        acceptedFiles: "image/*"

      # Only allow maxFiles uploaded
      myDropzone.on "maxfilesexceeded", (file) ->
        @removeFile file

      myDropzone.on "removedfile", (file) ->
        $("#image").val ""

      # Show any errors if the file upload fails.
      myDropzone.on "error", (file, message, xhr) ->
        $("#js-alert").showAlert "Error!", message, "alert-danger"

      # After uploading fill the form.
      myDropzone.on "success", (file, contents) ->
        $("#image").val file.name

      # Set a default image:
      # https://github.com/enyo/dropzone/wiki/FAQ#how-to-show-files-already-stored-on-server
      if defaultImg
        mockFile = { name: "Filename", size: 12345 }
        myDropzone.emit "addedfile", mockFile
        myDropzone.emit "thumbnail", mockFile, "/img/#{defaultImg}"
        myDropzone.options.maxFiles = 0

  App.vent.on "setup:dropzone", (el, defaultImg) ->
    API.setupDropzone el, defaultImg