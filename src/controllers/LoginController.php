<?php namespace Wardrobe\Cabinet\Controllers;

use Controller, View, Input, Redirect, Auth, Password;
use Wardrobe\Cabinet\Repositories\UserRepositoryInterface;

class LoginController extends Controller {

	/**
	 * The user repository implementations.
	 *
	 * @param  \Wardrobe\UserRepositoryInterface
	 */
	protected $user;

	/**
	 * Create a new login controller instance.
	 *
	 * @param UserRepositoryInterface $user
	 *
	 * @return LoginController
	 */
	public function __construct(UserRepositoryInterface $user)
	{
		$this->user = $user;
	}

	/**
	 * Get the user login view.
	 */
	public function create()
	{
		return View::make('cabinet::admin.login');
	}

	/**
	 * Handle a user login attempt.
	 */
	public function store()
	{
		if ($this->user->login(Input::get('email'), Input::get('password'), Input::get('remember')))
		{
			return Redirect::intended('wardrobe.admin.index');
		}

		return Redirect::back()
			->withInput()
			->with('login_errors', true);
	}

	/**
	 * Log out the user
	 */
	public function destroy()
	{
		Auth::logout();
		return Redirect::route('wardrobe.admin.login');
	}

	/**
	 * Forgot password form
	 */
	public function remindForm()
	{
		return View::make('cabinet::admin.auth.forgot');
	}

	/**
	 * Send an email to reset your password.
	 */
	public function remindSend()
	{
		$credentials = array('email' => Input::get('email'));

		return Password::remind($credentials, function($message, $user)
		{
			$message->subject('Reset your password');
		});
	}

}