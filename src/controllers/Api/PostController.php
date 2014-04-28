<?php namespace Wardrobe\Cabinet\Controllers\Api;

use Auth, Input, Response;
use Carbon\Carbon;
use Wardrobe\Cabinet\Repositories\PostRepositoryInterface;

class PostController extends BaseController {

	/**
	 * The post repository implementation.
	 *
	 * @var Wardrobe\PostRepositoryInterface
	 */
	protected $posts;

	/**
	 * Create a new API Posts controller.
	 *
	 * @param PostRepositoryInterface $posts
	 *
	 * @return \Wardrobe\Cabinet\Controllers\Api\PostController
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
		return $this->posts->all();
	}

	/**
	 * Store a newly created resource in storage.
	 *
	 * @return Response
	 */
	public function store()
	{
		$messages = $this->posts->validForCreation(Input::get('title'), Input::get('slug'));

		if (count($messages) > 0)
		{
			return Response::json($messages->all(), 400);
		}

		$date = (Input::get('publish_date') == "") ? "Now" : Input::get('publish_date');

		$post = $this->posts->create([
			'title' => Input::get('title'),
			'content' => Input::get('content'),
			'slug' => Input::get('slug'),
			'link_url' => Input::get('link_url'),
			'image' => Input::get('image'),
			'tags' => explode(',', Input::get('tags')),
			'active' => (bool) Input::get('active'),
			'user_id' => Input::get('user_id', Auth::user()->id),
			'publish_date' => Carbon::createFromTimestamp(strtotime($date))
		]);

		return (string) $this->posts->find($post->id);
	}

	/**
	 * Display the specified resource.
	 *
	 * @param  int  $id
	 * @return Response
	 */
	public function show($id)
	{
		return $this->posts->find($id);
	}

	/**
	 * Show the form for editing the specified resource.
	 *
	 * @param  int  $id
	 * @return Response
	 */
	public function edit($id)
	{
		return (string) $this->posts->find($id);
	}

	/**
	 * Update the specified resource in storage.
	 *
	 * @param  int  $id
	 * @return Response
	 */
	public function update($id)
	{
		$messages = $this->posts->validForUpdate($id, Input::get('title'), Input::get('slug'));

		if (count($messages) > 0)
		{
			return Response::json($messages->all(), 400);
		}

		$date = (Input::get('publish_date') == "") ? "Now" : Input::get('publish_date');

		$this->posts->update([
			'id' => $id,
			'title' => Input::get('title'),
			'content' => Input::get('content'),
			'slug' => Input::get('slug'),
			'link_url' => Input::get('link_url'),
			'image' => Input::get('image'),
			'tags' => explode(',', Input::get('tags')),
			'active' => (bool) Input::get('active'),
			'user_id' => Input::get('user_id', Auth::user()->id),
			'publish_date' => Carbon::createFromTimestamp(strtotime($date)),
		]);

		return (string) $this->posts->find($id);
	}

	/**
	 * Remove the specified resource from storage.
	 *
	 * @param  int  $id
	 * @return Response
	 */
	public function destroy($id)
	{
		$this->posts->delete($id);
	}

}
