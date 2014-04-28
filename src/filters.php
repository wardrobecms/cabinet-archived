<?php

Route::filter('wardrobe_auth', function()
{
	if (Auth::guest()) return Redirect::guest('wardrobe/login');
});

/**
 * Filter to check for CSRF attacks from the ajax requests.
 */
Route::filter('csrf_header', function()
{
	if (Session::token() != Request::header('x-csrf-token'))
	{
		throw new Illuminate\Session\TokenMismatchException;
	}
});