<?php

$wardrobeControllers = 'Wardrobe\\Cabinet\\Controllers\\';

Route::group(Config::get('cabinet::routes.admin_group_rules'), function() use ($wardrobeControllers)
{
	Route::resource('post', $wardrobeControllers.'PostController');
	Route::get('/', array('uses' => $wardrobeControllers.'AdminController@index', 'as' => 'wardrobe.admin.index'));
	Route::get('logout', array('uses' => $wardrobeControllers.'LoginController@destroy', 'as' => 'wardrobe.admin.logout'));
	Route::get('login', array('uses' => $wardrobeControllers.'LoginController@create', 'as' => 'wardrobe.admin.login'));
	Route::post('login', array('uses' => $wardrobeControllers.'LoginController@store'));
	Route::get('login/remind', array('uses' => $wardrobeControllers.'LoginController@remindForm', 'as' => 'wardrobe.admin.remindForm'));
	Route::post('login/remind', array('uses' => $wardrobeControllers.'LoginController@remindSend'));

});

/**
 * Password reset
 */
Route::get('password/reset/{token}', function($token)
{
	return View::make('cabinet::admin.auth.reset')->with('token', $token);
});

/**
* Password reset Success
*/
Route::post('password/reset/{token}', function()
{
	$credentials = array('email' => Input::get('email'));

	return Password::reset($credentials, function($user, $password)
	{
		$user->password = Hash::make($password);
		$user->save();
		return Redirect::to('wardrobe');
	});

});

/**
 * API Routes
 */
Route::group(Config::get('cabinet::routes.api_group_rules'), function() use ($wardrobeControllers)
{
//	Route::get('/', array('as' => 'wardrobe.api.index'));
	Route::resource('post', $wardrobeControllers.'Api\PostController');
//	Route::resource('tag', $wardrobeControllers.'Api\TagController');
//	Route::resource('user', $wardrobeControllers.'Api\UserController');
//	Route::controller('dropzone', $wardrobeControllers.'Api\DropzoneController');
});
