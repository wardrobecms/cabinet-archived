<!DOCTYPE html>
<html lang="en">
<head>
  <title>@yield('title') | Wardrobe</title>
  <meta name="env" content="{{ App::environment() }}">
  <meta name="token" content="{{ Session::token() }}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" type="text/css" href="{{ asset('admin/style.css') }}">
</head>
<body>

	<nav>
		<ul>
			<li><a class="write" href="{{ URL::route('wardrobe.post.create') }} "><i class="icon-plus"></i> {{ Lang::get('cabinet::wardrobe.write') }}</a></li>
			<li><a class="write" href="{{ URL::route('wardrobe.post.index') }} "><i class="icon-list"></i> {{ Lang::get('cabinet::wardrobe.posts') }}</a></li>
			<li><a class="accounts" href="#accounts"><i class="icon-user"></i> {{ Lang::get('cabinet::wardrobe.accounts') }}</a></li>
			<li><a href="{{ URL::route('wardrobe.admin.logout') }}"><i class="icon-off"></i> {{ Lang::get('cabinet::wardrobe.logout') }}</a></li>
		</ul>
	</nav>

	@include('cabinet::admin.inc.errors')

  @yield('content')

  <script src="//ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js"></script>
  @yield('footer.js')
</body>
</html>
