<?php

/**
 * Wardrobe Path
 *
 * Helper that allows you to easily get a theme path inside the views.
 * Example: @extends(theme_path('layout'))
 *
 * @param string $file - The file to load
 * @return string
 */
function wardrobe_path($file = null)
{
	return asset('/packages/wardrobe/cabinet/'.$file);
}

/**
 * Theme View Path
 *
 * Helper that allows you to easily get a theme view path inside the views.
 * Example: @extends(theme_path('layout'))
 *
 * @param string $file - The file to load
 * @return string
 */
function theme_view($file = null)
{
	return Config::get('wardrobe.theme').'.'.$file;
}