@Wardrobe.module "Views", (Views, App, Backbone, Marionette, $, _) ->

  class Views.ItemView extends Marionette.ItemView
    fillJSON: (data = {}) ->
      if @model?.isNew()
        @$('form').fillJSON(data)
      else
        @$('form').fillJSON(@model?.toJSON() or data)

    # Show or hide the validation errors based on validation failure.
    changeErrors: (model, errors, options) ->
      if _.isEmpty(errors) then @removeErrors() else @addErrors errors

    # Loop through the errors and display
    addErrors: (errors = {}) ->
      $("#js-errors").removeClass("hide").find("span").html "#{Lang.post_errors} <ul></ul>"
      for name, error of errors
        @addError error

    # Add any errors as a list item in the alert.
    addError: (error) ->
      msg = $("<li>").text(error)
      $("#js-errors span ul").append msg

    # Remove all errors from the form.
    removeErrors: ->
      $("#js-errors").addClass "hide"