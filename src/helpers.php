<?php

/**
 * Theme Path
 *
 * Helper that allows you to easily get a theme path inside the view
 * Here is an example: `{{ asset(theme_path('css/style.css')) }}`
 *
 * @param string $file - The file to load
 * @return string
 */
function theme_path($file = null)
{
	return '/'.Config::get('wardrobe.theme_dir').'/'.Config::get('wardrobe.theme').'/'.$file;
}

/**
 * Theme View Path
 *
 * Helper that allows you to easily get a theme view path
 * Here is an example: `@extends(theme_view('layout'))`
 *
 * @param string $file - The file to load
 * @return string
 */
function theme_view($file = null)
{
	return "themes.". Config::get('wardrobe.theme') .'.'.$file;
}

/**
 * Markdown Helper
 *
 * Helper that allows you to easily get a theme view path inside the views.
 * This uses a wrapper so its easy to be overridden from the base app if
 * prefered. Here is a quick example of how you can use it md(string)
 *
 * @param string $str
 *
 * @return string
 */
if ( ! function_exists('md'))
{
	function md($str)
	{
		return $str;
	}
}
