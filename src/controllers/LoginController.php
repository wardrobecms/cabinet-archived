<?php namespace Wardrobe\Cabinet\Controllers;

use Auth;
use Controller;
use Input;
use Password;
use Redirect;
use View;
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
	 *
	 * @return \Illuminate\View\View
	 */
	public function create()
	{
		return View::make('cabinet::admin.login');
	}

	/**
	 * Handle a user login attempt.
	 *
	 * @return \Illuminate\Routing\Redirector
	 */
	public function store()
	{
		if ($this->user->login(Input::get('email'), Input::get('password'), Input::get('remember')))
		{
			return Redirect::route('wardrobe.admin.index');
		}

		return Redirect::route('wardrobe.admin.login')
			->withInput()
			->with('login_errors', true);
	}

	/**
	 * Log out the user
	 *
	 * @return \Illuminate\Routing\Redirector
	 */
	public function destroy()
	{
		Auth::logout();
		return Redirect::route('wardrobe.admin.login');
	}

	/**
	 * Forgot password form
	 *
	 * @return \Illuminate\View\View
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
