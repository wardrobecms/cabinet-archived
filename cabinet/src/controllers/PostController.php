<?php namespace Wardrobe\Cabinet\Controllers;

use Wardrobe\Cabinet\Repositories\PostRepositoryInterface;
use Auth, View, Input, Redirect, Carbon\Carbon;

class PostController extends BaseController {

	/**
	 * Post interface
	 *
	 * @var \Wardrobe\Cabinet\Repositories\PostRepositoryInterface
	 */
	protected $post;

	/**
	 * Setup the post data
	 *
	 * @param PostRepositoryInterface $post
	 */
	public function __construct(PostRepositoryInterface $post)
	{
		parent::__construct();

		$this->post = $post;
	}

	/**
	 * Get the main admin view.
	 */
	public function index()
	{
		$posts = $this->post->all()->paginate(25);

		return View::make('cabinet::admin.posts.list', array('posts' => $posts));
	}

	/**
	 * Create a new post
	 *
	 * @return \Illuminate\View\View
	 */
	public function create()
	{
		return View::make('cabinet::admin.posts.add');
	}

	/**
	 * Store the new post
	 *
	 * @return \Illuminate\Http\RedirectResponse
	 */
	public function store()
	{
		$messages = $this->post->validForCreation(Input::get('title'), Input::get('slug'));

		if (count($messages) > 0)
		{
			return $this->showErrors($messages);
		}

		$this->post->create(
			Input::get('title'),
			Input::get('content'),
			Input::get('slug'),
			explode(',', Input::get('tags')),
			(bool) Input::get('active'),
			Input::get('user_id', Auth::user()->id),
			$this->formatDate(Input::get('publish_date'))
		);

		return Redirect::route('wardrobe.post.index');
	}

	/**
	 * Edit a post
	 *
	 * @param $id
	 *
	 * @return \Illuminate\View\View
	 */
	public function edit($id)
	{
		$post = $this->post->find($id);

		if ( ! $post)
		{
			return App::abort(404, 'Page not found');
		}

		return View::make('cabinet::admin.posts.edit', array('post' => $post));
	}

	/**
	 * Update a post
	 *
	 * @param $id
	 *
	 * @return \Illuminate\Http\RedirectResponse
	 */
	public function update($id)
	{
		$messages = $this->post->validForUpdate($id, Input::get('title'), Input::get('slug'));

		if (count($messages) > 0)
		{
			return $this->showErrors($messages);
		}

		$this->post->update(
			$id,
			Input::get('title'),
			Input::get('content'),
			Input::get('slug'),
			explode(',', Input::get('tags')),
			(bool) Input::get('active'),
			Input::get('user_id', Auth::user()->id),
			$this->formatDate(Input::get('publish_date'))
		);

		return Redirect::route('wardrobe.post.index');
	}

	/**
	 * Remove the specified resource from storage.
	 *
	 * @param  int  $id
	 * @return Response
	 */
	public function destroy($id)
	{
		if ( ! $this->post->find($id))
		{
			return App::abort(500);
		}

		$this->post->delete($id);

		return Redirect::back();
	}

	/**
	 * Show the errors from a failed validation
	 *
	 * @param $messages
	 *
	 * @return \Illuminate\Http\RedirectResponse
	 */
	protected function showErrors($messages)
	{
		return Redirect::back()
			->withInput()
			->withErrors($messages);
	}

	/**
	 * Format the date submitted
	 *
	 * @param $date
	 *
	 * @return Carbon
	 */
	protected function formatDate($date)
	{
		$date = ($date == "") ? "Now" : $date;
		return Carbon::createFromTimestamp(strtotime($date));
	}
}
