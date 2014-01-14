<?php

Route::filter('wardrobe_auth', function()
{
	if (Auth::guest()) return Redirect::guest('wardrobe/login');
});
