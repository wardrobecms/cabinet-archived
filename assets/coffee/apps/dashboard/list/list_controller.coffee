@Wardrobe.module "DashboardApp.List", (List, App, Backbone, Marionette, $, _) ->

  class List.Controller extends App.Controllers.Base

    initialize: ->
      chart = App.request "chart:entities"

      # After the post is fetched then load up everything.
      App.execute "when:fetched", chart, =>
        view = @getListView chart
        @show view

    getListView: (chart) ->
      new List.Chart
        model: chart
