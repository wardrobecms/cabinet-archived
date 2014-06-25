class Redactor

  constructor: (options) ->
    @apiUrl = options.apiUrl
    @storage = options.storage

  initialize: ->
    return $('#content').redactor
      toolbarFixedBox: true
      minHeight: 200 # pixels
      imageUpload: @apiUrl + "/dropzone/image"
      changeCallback: (html) =>
        @storage.put
          content: html

  getValue: ->
    return $("#content").val()