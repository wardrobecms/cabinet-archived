var gulp = require('gulp'),
    sass = require('gulp-sass'),
    neat = require('node-neat').includePaths;

var paths = {
    scss: './assets/sass/*.scss'
};

gulp.task('styles', function () {
    return gulp.src(paths.scss)
        .pipe(sass({
            includePaths: ['styles'].concat(neat)
        }))
        .pipe(gulp.dest('../../../public/packages/wardrobe/cabinet/css'))
        .pipe(gulp.dest('./public/css'));
});

gulp.task('watch', function(){
    gulp.watch(paths.scss, ['styles']);
});

gulp.task('default',function(){
    gulp.start('styles');
});
