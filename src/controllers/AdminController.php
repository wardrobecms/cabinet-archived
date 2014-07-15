<?php namespace Wardrobe\Cabinet\Controllers;

use View, Lang;
use Wardrobe\Cabinet\Repositories\PostRepositoryInterface;
use Wardrobe\Cabinet\Repositories\UserRepositoryInterface;

class AdminController extends BaseController {

	/**
	 * @var \Wardrobe\Cabinet\Repositories\UserRepositoryInterface
	 */
	private $user;

	/**
	 * @var PostRepositoryInterface
	 */
	private $posts;

	/**
	 * @param UserRepositoryInterface $user
	 * @param PostRepositoryInterface $posts
	 */
	public function __construct(UserRepositoryInterface $user, PostRepositoryInterface $posts)
	{
		parent::__construct();
		$this->user = $user;
		$this->posts = $posts;
	}

	/**
	 * Get the main admin view.
	 *
	 * @return \Illuminate\View\View
	 */
	public function index()
	{
		return View::make('cabinet::admin.index')
			->with('posts', $this->posts->all())
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
