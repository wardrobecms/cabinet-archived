# Post View
# ---------------
# A parent view which the add and edit views extend from.
@Wardrobe.module "Views", (Views, App, Backbone, Marionette, $, _) ->

  class Views.PostView extends App.Views.ItemView
    template: "post/_base/templates/form"
    className: "col-md-12"

    initialize: (opts) ->
      # Listen for when a markdown file is drag and dropped.
      App.vent.on "post:new:seed", (contents) =>
        @fillForm contents
      # Set a flag so we know when the tags are shown.
      @tagsShown = false
      @storage = opts.storage

    events:
      "click .publish" : "save"
      "click .js-toggle" : "toggleDetails"
      "click .icon-tags" : "toggleTags"
      "click .icon-user" : "showUsers"
      "click .icon-ellipsis-horizontal" : "insertReadMore"
      "click .js-status" : "setStatus"
      "keyup #title" : "localStorage"
      "change #js-user" : "localStorage"

    # When the model changes it's private _errors method call the changeErrors method.
    modelEvents:
      "change:_errors"  : "changeErrors"

    templateHelpers:
      # Set the primary button text based on the model active status.
      submitBtnText: ->
        if @active? or @active is "1" then Lang.post_publish else Lang.post_save
      # Generate a preview url.
      previewUrl: ->
        id = if @id then @id else "new"
        "#{App.request("get:url:blog")}/post/preview/#{id}"

    # When the view is shown in the DOM setup all the plugins
    onShow: ->
      @localStorage()
      @_triggerActive()

      if @model.isNew()
        @$('.js-toggle').trigger "click"
        $('#title').slugIt
          output: "#slug"
      else
        @$("#active").val @model.get("active")
        @$("##{@model.get("type")}").prop('checked', true).parent().addClass("active")
        @$("#content").val @model.get("parsed_content")

      @setUpEditor()
      @setupUsers()
      
      # Fetch the tags and setup the selectize plugin.
      App.request "tag:entities", (tags) =>
        @setUpTags tags

    _triggerActive: ->
      return @ if @model.isNew()
      if @model.get("active")
        @$(".js-active[value=1]").trigger("click")
      else
        $(".js-active[value=0]").trigger("click")

    # Setup the markdown editor
    setUpEditor: ->
      return $('#content').redactor
        toolbarFixedBox: true
        minHeight: 200 # pixels
        imageUpload: App.request("get:url:api") + "/dropzone/image"
        changeCallback: (html) =>
          @localStorage()

    # Save the post data to local storage
    localStorage: ->
      @storage.put
        title: @$('#title').val()
        slug: @$('#slug').val()
        image: @$('#image').val()
        type: @$('#type').val()
        active: @$('input[type=radio]:checked').val()
        content: @$("#content").val()
        tags: @$("#js-tags").val()
        user_id: @$("#js-user").val()
        publish_date: @$("#publish_date").val()

    # Populate the user select list.
    setupUsers: ->
      $userSelect = @$("#js-user")
      users = App.request "get:all:users"
      @$(".author").remove() if users.length is 1
      users.each (item) ->
        $userSelect.append $("<option></option>").val(item.id).html(item.get("first_name") + " " + item.get("last_name"))

      # If the model isNew then set the current user as author.
      if @model.isNew()
        user = App.request "get:current:user"
        stored = @storage.get()
        if stored?.user_id then $userSelect.val stored.user_id else $userSelect.val user.id
      else
        $userSelect.val @model.get("user_id")

    # Setup the tags as a selectize object.
    setUpTags: (tags) ->
      @$("#js-tags").selectize
        persist: true
        delimiter: ','
        maxItems: null
        options: @generateTagOptions(tags)
        render:
          item: (item) ->
            "<div><i class='icon-tag'></i> #{item.text}</div>"
          option: (item) ->
            "<div><i class='icon-tag'></i> #{item.text}</div>"
        create: (input) ->
          value: input
          text: input

    # Generate tags in a standard format for the plugin.
    generateTagOptions: (tags) ->
      opts = for tag in tags.pluck("tag") when tag isnt ""
        value: tag
        text: tag
      @customTags(opts)

    # Add any tags from the hidden input. Primarily used when using drag/drop.
    # This allows us to keep from going through the selectize api for adding and option and then the item.
    customTags: (opts) ->
      val = $("#js-tags").val()
      if val isnt ""
        for tag in val.split(",") when tag isnt ""
          opts.push
            value: tag
            text: tag
      opts

    # Toggle the tags based on toolbar click
    toggleTags: (e) ->
      if @tagsShown
        @$('.editor-toolbar').removeClass "open"
        @$('.editor-toolbar a, .editor-toolbar i').show()
        @$(".tags-bar").addClass("hide")
      else
        @$('.editor-toolbar').addClass "open"
        @$('.editor-toolbar a, .editor-toolbar i').hide()
        @$('.icon-tags').show()
        @$(".tags-bar").removeClass("hide")
        @$("js-tags").focus()

      @tagsShown = !@tagsShown

    # Save the post data
    save: (e) ->
      e.preventDefault()

      @processFormSubmit
        title: @$('#title').val()
        slug: @$('#slug').val()
        active: @$('#active').val()
        content: @$("#content").val()
        tags: @$("#js-tags").val()
        type: @$('#type').val()
        image: @$("#image").val()
        link_url: @$("#link_url").val()
        user_id: @$("#js-user").val()
        publish_date: @$("#publish_date").val()

    # Process the form and sync to the server
    processFormSubmit: (data) ->
      @model.save data,
        collection: @collection

    # Toggle the save button text based on status
    setStatus: (e) ->
      e.preventDefault()
      @localStorage()
      if $(e.currentTarget).data('action') is "publish"
        @$(".publish").text Lang.post_publish
        @$(".js-active").val 1
      else
        @$(".publish").text Lang.post_save
        @$(".js-active").val 0
