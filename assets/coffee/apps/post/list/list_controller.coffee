@Wardrobe.module "PostApp.List", (List, App, Backbone, Marionette, $, _) ->

  class List.Controller extends App.Controllers.Base

    initialize: ->
      view = @getListView()
      @show view

      @listenTo view, "childview:post:delete:clicked", (child, args) ->
        model = args.model
        if confirm Lang.post_delete_confirm.replace("##post##", _.escape(model.get("title"))) then model.destroy() else false

    getListView: ->
      new List.Posts
        collection: App.request "post:entities"
