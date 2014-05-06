<?php namespace Wardrobe\Cabinet\Controllers\Api;

use Wardrobe\Cabinet\Repositories\ChartRepository;

class ChartController extends BaseController {

	/**
	 * @var \Wardrobe\Cabinet\Repositories\ChartRepository
	 */
	private $chart;

	public function __construct(ChartRepository $chart)
	{
		parent::__construct();
//		$this->beforeFilter('wardrobe.auth');
		$this->chart = $chart;
	}

	public function getWords()
	{
		$data['yearly_post'] = $this->chart->yearlyTotalPosts();
		$data['words'] = $this->chart->wordsOverTime();
		$data['posts'] = $this->chart->postsOverTime();
		return \Response::json($data);
		// str_word_count
	}

} 