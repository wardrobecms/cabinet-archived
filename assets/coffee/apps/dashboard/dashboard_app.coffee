@Wardrobe.module "DashboardApp", (DashboardApp, App, Backbone, Marionette, $, _) ->

  class DashboardApp.Router extends Marionette.AppRouter
    appRoutes:
      "" : "stats"

  API =
    stats: ->
      new DashboardApp.List.Controller

  # Initialize the router.
  App.addInitializer ->
    new DashboardApp.Router
      controller: API