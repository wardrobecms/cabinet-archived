<?php namespace Wardrobe\Cabinet\Controllers;

use View, Lang;
use Wardrobe\Cabinet\Repositories\UserRepositoryInterface;

class AdminController extends BaseController {

	/**
	 * @var \Wardrobe\Cabinet\Repositories\UserRepositoryInterface
	 */
	private $user;

	public function __construct(UserRepositoryInterface $user)
	{
		parent::__construct();
		$this->user = $user;
	}

	/**
	 * Get the main admin view.
	 *
	 * @return \Illuminate\View\View
	 */
	public function index()
	{
		return View::make('cabinet::admin.index')
			->with('users', $this->user->all())
			->with('user', \Auth::user())
			->with('locale', $this->loadLanguage());
	}

	/**
	 * Load the designated language file
	 */
	protected function loadLanguage()
	{
		$locale = Lang::get('cabinet::wardrobe');
		return $locale;
	}
}
