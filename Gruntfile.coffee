module.exports = (grunt) ->

  # Project configuration.
  grunt.initConfig
    pkg: grunt.file.readJSON("package.json")

  # Clean out the source directory
    clean: ["assets/src/js/"]

  # Handle the bower components.
    bower:
      install:
        options:
          targetDir: "./assets/vendor/components"
          layout: "byComponent"
          copy: true
          install: true
          cleanTargetDir: true
          cleanBowerDir: false
      cleanup:
        options:
          cleanTargetDir: true
          cleanBowerDir: true
          install: false
          copy: false

    # Copy fonts from bower
    copy:
      fonts:
        expand: true
        cwd: 'assets/vendor/components/fontawesome/font/'
        src: '**'
        dest: 'public/admin/font/'
        flatten: true
        filter: 'isFile'

  # Compile coffee files to src/json
    coffee:
      glob_to_multiple:
        options:
          bare: true
        expand: true
        cwd: 'assets/coffee'
        src: ['**/*.coffee']
        dest: 'assets/src/js/'
        ext: '.js'

  # Compile our less styles
    less:
      development:
        options:
          paths: ["assets/vendor/components", "assets/less"]
        files:
          "public/admin/css/style.css": "assets/less/style.less"
      production:
        options:
          paths: ["assets/vendor/components", "assets/less"]
          compress: true
        files:
          "public/admin/css/style.min.css": "assets/less/style.less"

  # Concat all our src files
    concat:
      structure:
        src: [
          'assets/vendor/components/selectize/**/*.js'
          'assets/vendor/components/underscore/*.js'
          'assets/vendor/components/backbone/*.js'
          'assets/vendor/components/backbone.marionette/**/*.js'
#          'assets/vendor/components/backbone.syphon/**/*.js'
          'assets/vendor/components/momentjs/*.js'
          'assets/plugins/editor/*.js'
          'assets/plugins/redactor.js'
          'assets/vendor/components/js-md5/*.js'
          'assets/vendor/components/jstorage/*.js'
          'assets/vendor/components/bootstrap/js/**/*.js'
          'assets/plugins/qtip.js'
          'assets/plugins/editor/inline-attach.js'
          'assets/plugins/slugify.js'
          'assets/vendor/components/dropzone/**/*.js'
        ]
        dest: 'public/admin/js/structure.js'

      app:
        src: [
          'assets/src/js/templates.js'
          'assets/src/js/config/**/*.js'
          'assets/src/js/app.js'
          'assets/src/js/entities/_base/*.js'
          'assets/src/js/entities/*.js'
          'assets/src/js/controllers/**/*.js'
          'assets/src/js/views/**/*.js'
          'assets/src/js/*.js'
          'assets/src/js/helpers/*.js'
          'assets/src/js/**/*.js'
        ]
        dest: 'public/admin/js/app.js'

  # Compile the templates
    jst:
      compile:
        options:
        # templateSettings:
        #   interpolate : /\{\{(.+?)\}\}/g
          processName: (fileName) ->
            return fileName.replace("assets/coffee/apps/", "")
        files:
          "assets/src/js/templates.js": ["assets/coffee/apps/**/*.html"]

    watch:
      coffee:
        files: 'assets/coffee/**/*.coffee'
        tasks: ["clean", "jst", "coffee", "concat"]
        options:
          interrupt: true
      html:
        files: 'assets/coffee/**/*.html'
        tasks: ["jst", "concat"]
        options:
          interrupt: true
      less:
        files: 'assets/**/*.less'
        tasks: ["less"]
        options:
          interrupt: true
      src:
        files: 'assets/vendor/**/*.js'
        tasks: ["concat", "livereload"]
        options:
          interrupt: true

  # Load the plugins
  grunt.loadNpmTasks "grunt-contrib-concat"
  grunt.loadNpmTasks "grunt-contrib-coffee"
  grunt.loadNpmTasks "grunt-contrib-watch"
  grunt.loadNpmTasks "grunt-contrib-clean"
  grunt.loadNpmTasks "grunt-contrib-less"
  grunt.loadNpmTasks "grunt-contrib-jst"
  grunt.loadNpmTasks "grunt-bower-task"
  grunt.loadNpmTasks "grunt-contrib-copy"

  # Default task(s).
  grunt.registerTask "default", ["clean", "bower", "copy", "less", "coffee", "jst", "concat"]
  grunt.registerTask "js", ["clean", "coffee", "jst", "concat"]
  grunt.registerTask "deploy", ["clean", "bower", "copy", "less", "coffee", "jst", "concat"]
