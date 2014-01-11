<?php namespace Wardrobe\Cabinet;

use Illuminate\Support\ServiceProvider;

class CabinetServiceProvider extends ServiceProvider {

	/**
	 * Indicates if loading of the provider is deferred.
	 *
	 * @var bool
	 */
	protected $defer = false;

	/**
	 * Bootstrap the application events.
	 *
	 * @return void
	 */
	public function boot()
	{
		$this->package('wardrobe/cabinet');

		$this->bindRepositories();

		require_once __DIR__.'/../../helpers.php';
	}

	/**
	 * Register the service provider.
	 *
	 * @return void
	 */
	public function register()
	{
		//
	}

	/**
	 * Get the services provided by the provider.
	 *
	 * @return array
	 */
	public function provides()
	{
		return array();
	}

	/**
	 * Bind repositories.
	 *
	 * @return  void
	 */
	protected function bindRepositories()
	{
		$this->app->singleton('Wardrobe\Cabinet\Repositories\PostRepositoryInterface', 'Wardrobe\Cabinet\Repositories\DbPostRepository');

		$this->app->singleton('Wardrobe\Cabinet\Repositories\UserRepositoryInterface', 'Wardrobe\Cabinet\Repositories\DbUserRepository');

//		$this->app->bind('Wardrobe', function()
//		{
//			return new \Wardrobe\Core\Facades\Wardrobe(new Repositories\DbPostRepository);
//		});
	}

}
