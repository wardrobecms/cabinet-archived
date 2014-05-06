@Wardrobe.module "DashboardApp.List", (List, App, Backbone, Marionette, $, _) ->

  class List.Chart extends App.Views.ItemView
    template: "dashboard/list/templates/container"

    onShow: ->
      model = @model.toJSON()

      @$(".js-yearly-total").text model.yearly_post

      new Morris.Line
        element: 'post-over-time'
        data: model.posts.data
        parseTime: false
        xkey: 'label'
        ykeys: ['a', 'b']
        labels: model.posts.labels
        lineColors: ["rgba(151,187,205,0.7)", "#cccccc"]

      new Morris.Line
        element: 'words-per-month'
        data: model.words.data
        parseTime: false
        xkey: 'label'
        ykeys: ['a', 'b']
        labels: model.words.labels
        lineColors: ["rgba(151,187,205,0.7)", "#cccccc"]
