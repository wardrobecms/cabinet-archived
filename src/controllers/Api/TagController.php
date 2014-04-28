<?php namespace Wardrobe\Cabinet\Controllers\Api;

use Wardrobe\Cabinet\Repositories\PostRepositoryInterface;

class TagController extends BaseController {

	/**
	 * The post repository implementation.
	 *
	 * @var \Wardrobe\PostRepositoryInterface  $posts
	 */
	protected $posts;

	/**
	 * Create a new API Tag controller.
	 *
	 * @param PostRepositoryInterface $posts
	 *
	 * @return \Wardrobe\Cabinet\Controllers\Api\TagController
	 */
	public function __construct(PostRepositoryInterface $posts)
	{
		parent::__construct();

		$this->posts = $posts;

		$this->beforeFilter('wardrobe.auth');
	}

	/**
	 * Display a listing of the resource.
	 *
	 * @return Response
	 */
	public function index()
	{
		return $this->posts->allTags();
	}

}
