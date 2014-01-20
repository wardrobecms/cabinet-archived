<?php namespace Wardrobe\Cabinet\Repositories;

use DateTime;
use Mockery;
use Orchestra\Testbench\TestCase;

/**
 * Class DbPostRepositoryTest
 * @package Wardrobe\Cabinet\Repositories
 */
class DbPostRepositoryTest extends TestCase {

	private $post;

	public function setUp()
	{
		parent::setUp();

		$this->post = Mockery::mock('Wardrobe\Cabinet\Entities\Post');
	}

	public function tearDown()
	{
		Mockery::close();
	}

	private function DbPostRepository()
	{
		return new DbPostRepository($this->post);
	}

	public function testAll()
	{
		$this->post
			->shouldReceive('with')->once()->with(array('tags', 'user'))->andReturn($this->post)
			->shouldReceive('orderBy')->once()->with('publish_date', 'desc')->andReturn(array('wardrobe', 'cabinet'));

		$this->assertSame(array('wardrobe', 'cabinet'), $this->DbPostRepository()->all());
	}

	public function testActive()
	{
		$this->mockActive(15);

		$returned = $this->DbPostRepository()->active(15);

		$this->assertSame(array('active post'), $returned);
	}

	public function testActiveWithString()
	{
		$this->mockActive(5);

		$returned = $this->DbPostRepository()->active('wardrobe/cabinet');

		$this->assertSame(array('active post'), $returned);
	}

	private function mockActive($per_page)
	{
		$this->post
			->shouldReceive('with')->once()->with(array('tags', 'user'))->andReturn($this->post)
			->shouldReceive('where')->once()->with('active', 1)->andReturn($this->post)
			->shouldReceive('where')->once()->andReturn($this->post)
			->shouldReceive('orderBy')->once()->with('publish_date', 'desc')->andReturn($this->post)
			->shouldReceive('paginate')->once()->with($per_page)->andReturn(array('active post'));
	}

	public function testFind()
	{
		$this->post
			->shouldReceive('with')->once()->with(array('tags', 'user'))->andReturn($this->post)
			->shouldReceive('findOrFail')->once()->with(21)->andReturn($this->post);

		$returned = $this->DbPostRepository()->find(21);

		$this->assertSame($this->post, $returned);
	}

	public function testActiveByTag()
	{
		$this->mockActiveByTag('wardrobe', 15);

		$returned = $this->DbPostRepository()->activeByTag('wardrobe', 15);

		$this->assertSame(array('active post by tag'), $returned);
	}

	public function testActiveByTagWithString()
	{
		$this->mockActiveByTag('wardrobe', 5);

		$returned = $this->DbPostRepository()->activeByTag('wardrobe', 'cabinet');

		$this->assertSame(array('active post by tag'), $returned);
	}

	private function mockActiveByTag($tag, $per_page)
	{
		$this->post
			->shouldReceive('with')->once()->with(array('tags', 'user'))->andReturn($this->post)
			->shouldReceive('select')->once()->with('posts.*')->andReturn($this->post)
			->shouldReceive('join')->once()->with('tags', 'posts.id', '=', 'tags.post_id')->andReturn($this->post)
			->shouldReceive('where')->once()->with('tags.tag', '=', $tag)->andReturn($this->post)
			->shouldReceive('orderBy')->once()->with('posts.publish_date', 'desc')->andReturn($this->post)
			->shouldReceive('where')->once()->with('posts.active', 1)->andReturn($this->post)
			->shouldReceive('where')->once()->andReturn($this->post)
			->shouldReceive('distinct')->once()->withNoArgs()->andReturn($this->post)
			->shouldReceive('paginate')->once()->with($per_page)->andReturn(array('active post by tag'));
	}

	public function testSearch()
	{
		$this->mockSearch('wardrobe', 15);

		$returned = $this->DbPostRepository()->search('wardrobe', 15);

		$this->assertSame(array('wardrobe', 'cabinet'), $returned);
	}

	public function testSearchWithString()
	{
		$this->mockSearch('wardrobe', 5);

		$returned = $this->DbPostRepository()->search('wardrobe', 'cabinet');

		$this->assertSame(array('wardrobe', 'cabinet'), $returned);
	}

	public function mockSearch($search, $per_page)
	{
		$this->post
			->shouldReceive('with')->once()->with(array('tags', 'user'))->andReturn($this->post)
			->shouldReceive('select')->once()->with('posts.*')->andReturn($this->post)
			->shouldReceive('where')->once()->andReturn($this->post)
			->shouldReceive('orderBy')->once()->with('posts.publish_date', 'desc')->andReturn($this->post)
			->shouldReceive('where')->once()->with('posts.active', '=', 1)->andReturn($this->post)
			->shouldReceive('where')->once()->andReturn($this->post)
			->shouldReceive('groupBy')->once()->with('id')->andReturn($this->post)
			->shouldReceive('distinct')->once()->withNoArgs()->andReturn($this->post)
			->shouldReceive('paginate')->once()->with($per_page)->andReturn(array('wardrobe', 'cabinet'));
	}

	public function testCreate()
	{
		$this->post->shouldReceive('create')->once()->andReturn($this->post);

		$this->post->shouldReceive('tags')->once()->withNoArgs()->andReturn($this->post);
		$this->post->shouldReceive('delete')->once()->withNoArgs()->andReturn($this->post);

		$this->post->shouldReceive('tags')->once()->withNoArgs()->andReturn($this->post);
		$this->post->shouldReceive('createMany')->once()->andReturn($this->post);

		$returned = $this->DbPostRepository()->create('Wardrobe', 'foo bar', 'wardrobe', array('wardrobe', 'cabinet'), 1, 1, new DateTime());

		$this->assertSame($this->post, $returned);
	}
}
