@Wardrobe.module "Entities", (Entities, App, Backbone, Marionette, $, _) ->

  class Entities.Chart extends App.Entities.Model
    urlRoot: ->
      App.request("get:url:api") + "/charts/words"

  API =
    getChart: (cb) ->
      chart = new Entities.Chart
      chart.fetch()
      chart

  App.reqres.setHandler "chart:entities", (cb) ->
    API.getChart cb
